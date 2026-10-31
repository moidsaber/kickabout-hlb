import { body, handle, requirePlayer } from "@/lib/http";
import { parseAvailability } from "@/lib/parse";
import { HttpError, checkRateLimit, slotsForGame } from "@/lib/service";

// POST {gameId, text} -> {ok:true, result} | {ok:false, fallback:true, message}
// Never auto-saves: the client shows the result and the player confirms.
export const POST = handle(async (req) => {
  const player = await requirePlayer(req);
  const b = await body<{ gameId: string; text: string }>(req);
  const text = (b.text ?? "").trim();
  if (!text) throw new HttpError(400, "Tell us when you're free");
  if (!(await checkRateLimit(`player:${player.id}`)))
    return { ok: false, fallback: true, message: "You've hit the limit (10 an hour) — just tick the slots instead." };
  const slots = await slotsForGame(b.gameId);
  if (!slots.length) throw new HttpError(404, "Game not found");
  try {
    const result = await parseAvailability({ text, slots: slots.map((s) => ({ id: s.id, startsAt: s.starts_at })) });
    return { ok: true, result };
  } catch (e) {
    console.error("parse failed", e);
    return { ok: false, fallback: true, message: "Couldn't read that right now — please tick the slots instead." };
  }
});
