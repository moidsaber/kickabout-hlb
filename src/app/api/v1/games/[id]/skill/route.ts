import { adminKeyOf, body, handle, type Ctx } from "@/lib/http";
import { assertAdmin, setSkill } from "@/lib/service";

// POST (admin) {signupId, skill: 1-5 | null}
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  await assertAdmin(id, adminKeyOf(req));
  const b = await body<{ signupId: string; skill: number | null }>(req);
  await setSkill(id, b.signupId, b.skill);
  return { ok: true };
});
