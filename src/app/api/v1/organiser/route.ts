import { body, handle, organiserCodeRequired, requireOrganiser } from "@/lib/http";

// GET -> {required}: does starting a game need an organiser code?
export const GET = handle(async () => ({ required: organiserCodeRequired() }));

// POST {code} -> {ok:true} | 403 wrong code | 429 too many wrong guesses
// Lets the home page check a code before showing the create form.
export const POST = handle(async (req) => {
  const b = await body<{ code?: string }>(req);
  await requireOrganiser(req, b.code ?? "");
  return { ok: true };
});
