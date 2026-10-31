import "server-only";
import { NextRequest } from "next/server";
import { HttpError, playerByPhone, playerByToken } from "./service";

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

export const adminKeyOf = (req: NextRequest) =>
  req.headers.get("x-admin-key") ?? req.nextUrl.searchParams.get("key");

export async function body<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}
