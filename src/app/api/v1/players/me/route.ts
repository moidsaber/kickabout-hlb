import { z } from "zod";
import { body, handle, requirePlayer } from "@/lib/http";
import { HttpError, publicPlayer, updateWeekly } from "@/lib/service";

export const GET = handle(async (req) => ({ player: publicPlayer(await requirePlayer(req)) }));

const Weekly = z.array(z.object({
  day: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
  start: z.string().regex(/^\d\d:\d\d$/),
  end: z.string().regex(/^\d\d:\d\d$/),
}));

// PATCH {weekly}
export const PATCH = handle(async (req) => {
  const p = await requirePlayer(req);
  const b = await body<{ weekly?: unknown }>(req);
  const w = Weekly.safeParse(b.weekly);
  if (!w.success) throw new HttpError(400, "Invalid weekly availability");
  await updateWeekly(p.id, w.data);
  return { ok: true };
});
