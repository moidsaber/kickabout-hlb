import { body, handle } from "@/lib/http";
import { identify } from "@/lib/service";

// POST {name, phone?} (+ x-player-token header if known) -> player incl. token to store in localStorage
export const POST = handle(async (req) => {
  const b = await body<{ name: string; phone?: string }>(req);
  const p = await identify({ name: b.name ?? "", phone: b.phone, token: req.headers.get("x-player-token") });
  return { player: { id: p.id, name: p.name, phone: p.phone, weekly: p.weekly, monzoUsername: p.monzo_username }, token: p.token };
});
