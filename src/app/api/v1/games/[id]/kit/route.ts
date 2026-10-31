import { adminKeyOf, body, currentPlayer, handle, type Ctx } from "@/lib/http";
import { getGameState, setKit } from "@/lib/service";

// POST {duty: "ball"|"bibs", signupId | null}
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const b = await body<{ duty: string; signupId: string | null }>(req);
  const key = adminKeyOf(req);
  const admin = key ? (await getGameState(id, { adminKey: key })).isAdmin : false;
  await setKit(id, b.duty, b.signupId ?? null, { player: await currentPlayer(req), admin });
  return { ok: true };
});
