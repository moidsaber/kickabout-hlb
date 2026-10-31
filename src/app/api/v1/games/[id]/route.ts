import { adminKeyOf, body, currentPlayer, handle, type Ctx } from "@/lib/http";
import { assertAdmin, getGameState, updateGame } from "@/lib/service";

// GET -> full game state (pass ?key= or x-admin-key for organiser view)
export const GET = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  return getGameState(id, { adminKey: adminKeyOf(req), viewer: await currentPlayer(req) });
});

// PATCH (admin) {title, location, mapsUrl, costPence, cap, monzoUsername, dropoutHours, status}
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  await assertAdmin(id, adminKeyOf(req));
  await updateGame(id, await body(req));
  return { ok: true };
});
