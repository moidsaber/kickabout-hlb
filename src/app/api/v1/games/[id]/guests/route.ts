import { body, handle, requirePlayer, type Ctx } from "@/lib/http";
import { addGuest } from "@/lib/service";

// POST {name} -> adds "<you>'s guest". Remove a guest via /drop.
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const p = await requirePlayer(req);
  const b = await body<{ name: string }>(req);
  await addGuest(id, p, b.name ?? "");
  return { ok: true };
});
