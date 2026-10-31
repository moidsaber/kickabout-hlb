import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { HttpError, playerByPhone, playerByToken, recentHits, recordHit } from "./service";

export type Ctx = { params: Promise<{ id: string }> };

/** Wrap a handler: JSON errors, no caching. */
export function handle<C>(fn: (req: NextRequest, ctx: C) => Promise<unknown>) {
  return async (req: NextRequest, ctx: C) => {
    try {
      const data = await fn(req, ctx);
      return Response.json(data ?? { ok: true }, { headers: { "cache-control": "no-store" } });
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      console.error(e);
      return Response.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

/**
 * Current player from the browser token. A future WhatsApp bot can instead send
 * `x-bot-key: $BOT_API_KEY` + `x-player-phone` to act on behalf of a player.
 */
export async function currentPlayer(req: NextRequest) {
  const botKey = process.env.BOT_API_KEY;
  if (botKey && req.headers.get("x-bot-key") === botKey) {
    const phone = req.headers.get("x-player-phone");
    if (phone) return playerByPhone(phone);
  }
  return playerByToken(req.headers.get("x-player-token"));
}

export async function requirePlayer(req: NextRequest) {
  const p = await currentPlayer(req);
  if (!p) throw new HttpError(401, "Tell us your name first");
  return p;
}

/** Client IP as reported by Vercel's edge (falls back to "unknown" locally). */
export const clientIp = (req: NextRequest) =>
  req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";

// ---------- organiser code: who may start games ----------

const ORGANISER_FAIL_LIMIT = 10; // wrong guesses per network per hour

/** Case-insensitive, whitespace-tolerant, constant-time comparison with ORGANISER_CODE. */
export function organiserCodeMatches(given: string | null | undefined, expected = process.env.ORGANISER_CODE) {
  if (!expected || !given) return false;
  const norm = (s: string) => createHash("sha256").update(s.trim().toLowerCase().replace(/\s+/g, " ")).digest();
  return timingSafeEqual(norm(given), norm(expected));
}

/** Is a code needed to start games? (Always in production; locally only if one is set.) */
export const organiserCodeRequired = () => !!process.env.ORGANISER_CODE || process.env.NODE_ENV === "production";

/**
 * Throws unless the request may start games: a valid organiser code (header
 * `x-organiser-code`, or `code` passed in), or the bot key. Wrong guesses are
 * limited per network. With no ORGANISER_CODE set, production stays locked.
 */
export async function requireOrganiser(req: NextRequest, code?: string | null) {
  const botKey = process.env.BOT_API_KEY;
  if (botKey && req.headers.get("x-bot-key") === botKey) return;
  if (!process.env.ORGANISER_CODE) {
    if (process.env.NODE_ENV === "production")
      throw new HttpError(503, "Starting games is locked: the server has no ORGANISER_CODE set.");
    return; // local development without a code: open
  }
  const given = code ?? req.headers.get("x-organiser-code");
  if (!given) throw new HttpError(403, "Organiser code needed to start a game");
  const failKey = `organiser-fail:${clientIp(req)}`;
  if ((await recentHits(failKey, 60)) >= ORGANISER_FAIL_LIMIT)
    throw new HttpError(429, "Too many wrong codes — try again in an hour");
  if (organiserCodeMatches(given)) return;
  await recordHit(failKey);
  throw new HttpError(403, "That organiser code isn't right");
}

export const adminKeyOf = (req: NextRequest) =>
  req.headers.get("x-admin-key") ?? req.nextUrl.searchParams.get("key");

export async function body<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}
