import { body, clientIp, handle } from "@/lib/http";
import { HttpError, checkRateLimits, identify } from "@/lib/service";

// POST {name, phone?} (+ x-player-token header if known) -> player incl. token to store in localStorage
export const POST = handle(async (req) => {
  // Each device signs in once, so this only bites someone mass-creating fake players.
  const blocked = await checkRateLimits([{ key: `players-ip:${clientIp(req)}`, limit: 30, windowMinutes: 60, label: "" }]);
  if (blocked) throw new HttpError(429, "Too many sign-ins from this network — try again later");
  const b = await body<{ name: string; phone?: string }>(req);
  const p = await identify({ name: b.name ?? "", phone: b.phone, token: req.headers.get("x-player-token") });
  return { player: { id: p.id, name: p.name, phone: p.phone, weekly: p.weekly, monzoUsername: p.monzo_username }, token: p.token };
});
