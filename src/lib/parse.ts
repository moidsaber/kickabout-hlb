import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ParsedAvailability, buildParsePrompt, normaliseParsed, type ParseSlot } from "./parse-core";
import { PitchPattern, buildPitchPrompt, expandPitch } from "./pitch-core";

export const PARSE_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";

let client: Anthropic | null = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  return (client ??= new Anthropic({ timeout: 20_000, maxRetries: 1 }));
}

export async function parseAvailability(input: {
  text: string;
  slots: ParseSlot[];
  now?: Date;
  anthropic?: Pick<Anthropic, "messages">;
}) {
  const { system, user } = buildParsePrompt(input.text, input.slots, input.now ?? new Date());
  const anthropic = input.anthropic ?? getClient();
  const res = await anthropic.messages.parse({
    model: PARSE_MODEL,
    max_tokens: 2000, // short structured answer; also caps the cost of any single request
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort: "low", format: zodOutputFormat(ParsedAvailability) },
  });
  if (res.stop_reason === "refusal") throw new Error("Model declined the request");
  if (!res.parsed_output) throw new Error(`No structured output (stop_reason=${res.stop_reason})`);
  return normaliseParsed(res.parsed_output, input.slots);
}

/** Organiser's pitch description -> concrete kick-off times. */
export async function parsePitchTimes(input: { text: string; now?: Date; anthropic?: Pick<Anthropic, "messages"> }) {
  const now = input.now ?? new Date();
  const { system, user } = buildPitchPrompt(input.text, now);
  const anthropic = input.anthropic ?? getClient();
  const res = await anthropic.messages.parse({
    model: PARSE_MODEL,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort: "low", format: zodOutputFormat(PitchPattern) },
  });
  if (res.stop_reason === "refusal") throw new Error("Model declined the request");
  if (!res.parsed_output) throw new Error(`No structured output (stop_reason=${res.stop_reason})`);
  return expandPitch(res.parsed_output, now);
}
