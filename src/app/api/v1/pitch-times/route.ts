import { body, handle } from "@/lib/http";
import { parsePitchTimes } from "@/lib/parse";
import { MAX_TEXT, OFF_TOPIC_PITCH_MESSAGE } from "@/lib/limits";
import { looksLikeAvailability } from "@/lib/parse-core";
import { HttpError, checkRateLimits } from "@/lib/service";

// POST {text} -> {ok:true, times:[{local, startsAt}], notes}
//             | {ok:false, offTopic:true, message} | {ok:false, fallback:true, message}
// Turns an organiser's description of when the pitch is free into kick-off times.
// Same protections as the players' box: length limit, free pre-check, AI on-topic check, rate limits.
export const POST = handle(async (req) => {
  const b = await body<{ text?: string }>(req);
  const text = (b.text ?? "").trim();
  if (!text) throw new HttpError(400, "Describe when the pitch is free");
  if (text.length > MAX_TEXT) throw new HttpError(400, `Keep it under ${MAX_TEXT} characters`);
  if (!looksLikeAvailability(text)) return { ok: false, offTopic: true, message: OFF_TOPIC_PITCH_MESSAGE };

  const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const blocked = await checkRateLimits([
    { key: `pitch-ip:${ip}`, limit: 20, windowMinutes: 60, label: "Too many requests from this network" },
    { key: "global", limit: 300, windowMinutes: 24 * 60, label: "The reader is resting for today" },
  ]);
  if (blocked) return { ok: false, fallback: true, message: `${blocked.label} — use “Tap to pick” instead.` };

  try {
    const r = await parsePitchTimes({ text });
    if (!r.onTopic) return { ok: false, offTopic: true, message: OFF_TOPIC_PITCH_MESSAGE };
    if (!r.times.length) return { ok: false, fallback: true, message: "Couldn't find any upcoming times in that — try “Tap to pick”." };
    return { ok: true, times: r.times, notes: r.notes };
  } catch (e) {
    console.error("pitch parse failed", e);
    return { ok: false, fallback: true, message: "Couldn't read that right now — use “Tap to pick” instead." };
  }
});
