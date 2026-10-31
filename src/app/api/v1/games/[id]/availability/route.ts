import { body, handle, requirePlayer, type Ctx } from "@/lib/http";
import { setAvailability } from "@/lib/service";
import type { WeeklyWindow } from "@/lib/logic";

// POST {available: slotId[], weekly?: WeeklyWindow[]}  (weekly is saved as the player's usual week)
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const p = await requirePlayer(req);
  const b = await body<{ available: string[]; weekly?: WeeklyWindow[] }>(req);
  await setAvailability(id, p, { available: Array.isArray(b.available) ? b.available : [], weekly: b.weekly });
  return { ok: true };
});
