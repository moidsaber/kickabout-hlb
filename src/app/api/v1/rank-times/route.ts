import { body, handle, requireOrganiser } from "@/lib/http";
import { HttpError, rankTimes } from "@/lib/service";
import { MAX_SLOTS } from "@/lib/limits";

// POST {times: ISO[]} -> {regulars, scores: [{startsAt, available}]}
// How many recent regulars are usually free at each candidate kick-off.
export const POST = handle(async (req) => {
  await requireOrganiser(req);
  const b = await body<{ times?: unknown }>(req);
  if (!Array.isArray(b.times) || b.times.length > MAX_SLOTS) throw new HttpError(400, `Send up to ${MAX_SLOTS} times`);
  const dates = b.times.map((t) => new Date(String(t))).filter((d) => !isNaN(d.getTime()));
  return rankTimes(dates);
});
