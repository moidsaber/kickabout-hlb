import "server-only";
import postgres from "postgres";
import { dbOptions } from "./db-options";

// Supabase: use the "Transaction pooler" connection string (port 6543).
const g = globalThis as unknown as { __sql?: postgres.Sql };

export function db() {
  if (!g.__sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    g.__sql = postgres(url, dbOptions(url));
  }
  return g.__sql;
}

/**
 * Drop every connection and start afresh on the next query. Called when a
 * request times out, so one stuck query can't jam the app until it restarts.
 */
export function resetDb() {
  const old = g.__sql;
  g.__sql = undefined;
  old?.end({ timeout: 0 }).catch(() => {});
}
