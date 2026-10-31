import { adminKeyOf, body, handle, type Ctx } from "@/lib/http";
import { assertAdmin, confirmSlot } from "@/lib/service";

// POST (admin) {slotId}
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  await assertAdmin(id, adminKeyOf(req));
  const b = await body<{ slotId: string }>(req);
  await confirmSlot(id, b.slotId);
  return { ok: true };
});
