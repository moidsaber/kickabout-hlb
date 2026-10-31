import { adminKeyOf, body, currentPlayer, handle, type Ctx } from "@/lib/http";
import { dropOut, getGameState, rejoin } from "@/lib/service";

// POST {signupId, rejoin?: boolean} -> drop out / rejoin. Player for self+guests, or admin (?key=) for anyone.
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const b = await body<{ signupId: string; rejoin?: boolean }>(req);
  const key = adminKeyOf(req);
  const admin = key ? (await getGameState(id, { adminKey: key })).isAdmin : false;
  const actor = { player: await currentPlayer(req), admin };
  if (b.rejoin) await rejoin(id, b.signupId, actor);
  else await dropOut(id, b.signupId, actor);
  return { ok: true };
});
