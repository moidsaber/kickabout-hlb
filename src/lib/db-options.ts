// Connection settings shared by the app and scripts (no server-only import).
import type { Options, PostgresType } from "postgres";

export function dbOptions(url: string): Options<Record<string, PostgresType>> {
  const local = /localhost|127\.0\.0\.1/.test(url);
  return {
    // Supabase's transaction pooler (port 6543) doesn't support prepared statements
    prepare: false,
    max: 3,
    // One query at a time per connection. postgres.js v4 otherwise pipelines up
    // to 100 queries per connection, which Supabase's pooler can stall on.
    max_pipeline: 1,
    // Never wait forever: give up if no connection frees up / can be opened
    queue_timeout: 15,
    connect_timeout: 10,
    idle_timeout: 20,
    ssl: local ? false : "require",
    transform: { undefined: null },
  };
}
