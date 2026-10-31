import { adminKeyOf, body, handle, type Ctx } from "@/lib/http";
import { assertAdmin, setPaid } from "@/lib/service";

// POST (admin) {playerId, paid}
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  await assertAdmin(id, adminKeyOf(req));
  const b = await body<{ playerId: string; paid: boolean }>(req);
  await setPaid(id, b.playerId, !!b.paid);
  return { ok: true };
});
