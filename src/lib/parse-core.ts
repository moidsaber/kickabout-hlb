// Prompt + schema for natural-language availability. No server deps, so tests
// and a future WhatsApp bot can import it directly.
import { z } from "zod";
import { formatLongDate, formatSlot, TZ } from "./time";

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/);

export const ParsedAvailability = z.object({
  slots: z.array(
    z.object({
      slotId: z.string(),
      available: z.boolean(),
      confidence: z.enum(["high", "low"]),
    }),
  ),
  weekly: z.array(
    z.object({
      day: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
      start: HHMM,
      end: HHMM,
    }),
  ),
  notes: z.string(),
});
export type ParsedAvailability = z.infer<typeof ParsedAvailability>;

export type ParseSlot = { id: string; startsAt: string | Date };

export const SYSTEM_PROMPT = `You turn a casual message from a 7-a-side football player about when they're free into structured availability.

Timezone is ${TZ}. All times are local, 24-hour "HH:MM".

Default meanings (use these unless the player says otherwise):
- "evening" / "evenings" / "tonight" = 18:00-22:00
- "after work" = after 18:00, i.e. 18:00-22:00
- "after N" with no am/pm means N pm for N from 1 to 11, until 22:00 (e.g. "after 6" = 18:00-22:00)
- "morning" = 09:00-12:00, "afternoon" = 12:00-18:00
- "all day" / "any time" / "free" with no time = 09:00-22:00
- "weekdays" = mon-fri, "weekend" = sat-sun
- "not X", "can't do X", "busy X" = unavailable for X

For "slots": return every candidate slot exactly once, using its id. A slot is available if its kick-off time falls inside a window the player is free.
- confidence "high": the message clearly covers that slot's day and time.
- confidence "low": you are inferring, the message is vague or ambiguous about it, or it doesn't mention that day at all (in that case available=false).
- Relative dates ("this weekend", "tomorrow", "next tuesday") are relative to today's date given below. "This weekend" is the coming Saturday and Sunday (or the current weekend if today is Saturday or Sunday).

For "weekly": the player's recurring weekly pattern, as available windows only. Include only statements that read as general habits ("weekday evenings", "mondays after 6", "saturdays"). One-off statements about specific dates ("this weekend", "tomorrow") do NOT go in weekly. Use an empty list if nothing recurring was said.

For "notes": one short, friendly sentence summarising how you read the message, flagging anything ambiguous.`;

export function buildParsePrompt(text: string, slots: ParseSlot[], now: Date) {
  const lines = slots.map((s) => `- id: ${s.id} -> ${formatSlotLong(new Date(s.startsAt))}`);
  const user = `Today is ${formatLongDate(now)} (${TZ}).

Candidate kick-off slots for this game:
${lines.join("\n") || "(none)"}

Player's message:
"""
${text.slice(0, 1000)}
"""`;
  return { system: SYSTEM_PROMPT, user };
}

function formatSlotLong(d: Date) {
  return `${formatLongDate(d)}, ${formatSlot(d).split(", ").pop()}`;
}

/** Keep only known slot ids, add missing ones as unavailable/low, drop bad windows. */
export function normaliseParsed(p: ParsedAvailability, slots: ParseSlot[]): ParsedAvailability {
  const known = new Map(p.slots.map((s) => [s.slotId, s]));
  return {
    slots: slots.map((s) => known.get(s.id) ?? { slotId: s.id, available: false, confidence: "low" as const }),
    weekly: p.weekly.filter((w) => w.start < w.end),
    notes: p.notes,
  };
}
