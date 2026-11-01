import { adminKeyOf, body, handle, type Ctx } from "@/lib/http";
import { HttpError, assertAdmin, removePlayerFromGame } from "@/lib/service";

// POST (admin) {playerId} -> {profileDeleted}
// Removes a player (and the mates they added) from this game; deletes the
// profile too if it isn't used anywhere else.
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  await assertAdmin(id, adminKeyOf(req));
  const b = await body<{ playerId?: string }>(req);
  if (!b.playerId) throw new HttpError(400, "playerId required");
  return removePlayerFromGame(id, b.playerId);
});
