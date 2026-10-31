import "server-only";
import postgres from "postgres";

// Supabase: use the "Transaction pooler" connection string (port 6543).
// prepare:false is required for the transaction pooler.
const g = globalThis as unknown as { __sql?: postgres.Sql };

export function db() {
  if (!g.__sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const local = /localhost|127\.0\.0\.1/.test(url);
    g.__sql = postgres(url, {
      prepare: false,
      max: local ? 5 : 3,
      ssl: local ? false : "require",
      idle_timeout: 20,
      transform: { undefined: null },
    });
  }
  return g.__sql;
}
