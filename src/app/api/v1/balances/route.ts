import { handle } from "@/lib/http";
import { balances } from "@/lib/service";

// GET -> running balances across all confirmed games
export const GET = handle(async () => ({ balances: await balances() }));
