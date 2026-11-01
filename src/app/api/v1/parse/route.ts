import { body, clientIp, handle, requirePlayer } from "@/lib/http";
import { parseAvailability } from "@/lib/parse";
import { MAX_TEXT, OFF_TOPIC_MESSAGE, looksLikeAvailability } from "@/lib/parse-core";
import { HttpError, checkRateLimits, gameCap, slotsForGame } from "@/lib/service";

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

  const slots = await slotsForGame(b.gameId);
  if (!slots.length) throw new HttpError(404, "Game not found");
  const cap = await gameCap(b.gameId);

  const ip = clientIp(req);
  const FOREVER = 60 * 24 * 60; // minutes (60 days) — effectively "for this game"
  const blocked = await checkRateLimits([
    { key: `player:${player.id}`, limit: 3, windowMinutes: 60, label: "You've used your 3 tries this hour" },
    // Extra profiles don't help: each game has a total allowance...
    { key: `game:${b.gameId}`, limit: cap * 2, windowMinutes: FOREVER, label: "The AI helper is used up for this game" },
    // ...and one network can only use part of it (generous: shared Wi-Fi / mobile networks)
    { key: `ip-game:${ip}:${b.gameId}`, limit: 10, windowMinutes: FOREVER, label: "Too many tries from this network for this game" },
    // App-wide cost backstop
    { key: "global", limit: 300, windowMinutes: 24 * 60, label: "The AI helper is resting for today" },
  ]);
  if (blocked) return { ok: false, fallback: true, message: `${blocked.label} — just paint your times below.` };
  try {
    const result = await parseAvailability({ text, slots: slots.map((s) => ({ id: s.id, startsAt: s.starts_at })) });
    if (!result.onTopic) return { ok: false, offTopic: true, message: OFF_TOPIC_MESSAGE };
    return { ok: true, result };
  } catch (e) {
    console.error("parse failed", e);
    return { ok: false, fallback: true, message: "Couldn't read that right now — please paint your times below." };
  }
}, { timeoutMs: 50_000 }); // AI calls can take a while on games with many times
