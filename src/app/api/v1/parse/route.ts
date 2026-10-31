import { body, clientIp, handle, requirePlayer } from "@/lib/http";
import { parseAvailability } from "@/lib/parse";
import { MAX_TEXT, OFF_TOPIC_MESSAGE, looksLikeAvailability } from "@/lib/parse-core";
import { HttpError, checkRateLimits, slotsForGame } from "@/lib/service";

// POST {gameId, text}
//  -> {ok:true, result}
//  -> {ok:false, offTopic:true, message}   text isn't about availability (nothing filled in)
//  -> {ok:false, fallback:true, message}   rate-limited or AI unavailable: tick manually
// Never auto-saves: the client shows the result and the player confirms.
export const POST = handle(async (req) => {
  const player = await requirePlayer(req);
  const b = await body<{ gameId: string; text: string }>(req);
  const text = (b.text ?? "").trim();
  if (!text) throw new HttpError(400, "Tell us when you're free");
  if (text.length > MAX_TEXT) throw new HttpError(400, `Keep it under ${MAX_TEXT} characters`);

  // Free pre-check: obviously off-topic text never reaches the AI.
  if (!looksLikeAvailability(text)) return { ok: false, offTopic: true, message: OFF_TOPIC_MESSAGE };

  const ip = clientIp(req);
  const blocked = await checkRateLimits([
    { key: `player:${player.id}`, limit: 10, windowMinutes: 60, label: "You've hit the limit (10 an hour)" },
    // New names are free to create, so also limit per device/network...
    { key: `ip:${ip}`, limit: 30, windowMinutes: 60, label: "Too many requests from this network" },
    // ...and cap total AI use as a cost backstop.
    { key: "global", limit: 300, windowMinutes: 24 * 60, label: "The reader is resting for today" },
  ]);
  if (blocked) return { ok: false, fallback: true, message: `${blocked.label} — just tick the slots instead.` };

  const slots = await slotsForGame(b.gameId);
  if (!slots.length) throw new HttpError(404, "Game not found");
  try {
    const result = await parseAvailability({ text, slots: slots.map((s) => ({ id: s.id, startsAt: s.starts_at })) });
    if (!result.onTopic) return { ok: false, offTopic: true, message: OFF_TOPIC_MESSAGE };
    return { ok: true, result };
  } catch (e) {
    console.error("parse failed", e);
    return { ok: false, fallback: true, message: "Couldn't read that right now — please tick the slots instead." };
  }
});
