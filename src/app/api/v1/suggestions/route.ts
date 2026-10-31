import { handle } from "@/lib/http";
import { kickoffSuggestions } from "@/lib/service";

// GET -> top 3 kick-off times from recent players' stored weekly availability
export const GET = handle(async () => ({ suggestions: await kickoffSuggestions() }));
