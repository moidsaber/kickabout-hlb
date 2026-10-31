import { body, currentPlayer, handle } from "@/lib/http";
import { createGame, listGames, type CreateGameInput } from "@/lib/service";

// GET ?upcoming=1 -> recent games (public info only)
export const GET = handle(async (req) => ({
  games: await listGames({ upcomingOnly: req.nextUrl.searchParams.get("upcoming") === "1" }),
}));

// POST CreateGameInput -> {id, adminKey, url, adminUrl}
export const POST = handle(async (req) => {
  const b = await body<CreateGameInput>(req);
  const creator = await currentPlayer(req);
  const { id, adminKey } = await createGame(b, creator);
  const origin = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
  return { id, adminKey, url: `${origin}/g/${id}`, adminUrl: `${origin}/g/${id}/admin?key=${adminKey}` };
});
