// Connection health check, using exactly the app's database settings.
//   npm run db:check
// Read-only: runs a few small queries with a time limit each and reports
// which step (if any) is slow or stuck, plus any stuck database sessions.
import postgres from "postgres";
import { dbOptions } from "../src/lib/db-options";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("✗ DATABASE_URL is not set (check .env.local)");
  process.exit(1);
}
const sql = postgres(url, dbOptions(url));
const host = url.replace(/^.*@/, "").replace(/\/.*$/, "");

async function step(name: string, run: () => Promise<unknown>, limitMs = 10_000) {
  const t0 = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const out = await Promise.race([
      run(),
      new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`no answer after ${limitMs / 1000}s`)), limitMs))),
    ]);
    console.log(`✓ ${name} (${Date.now() - t0} ms)`);
    return out;
  } catch (e) {
    console.log(`✗ ${name}: ${(e as Error).message}`);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`Checking ${host} ...\n`);
  const ok = await step("connect + select 1", () => sql`select 1 as ok`);
  if (!ok) {
    console.log("\nCan't get an answer at all. Check the Supabase project isn't paused, then see the README's troubleshooting section.");
    return;
  }
  await step("count games", () => sql`select count(*)::int as n from games`);
  await step("query with a value", () => sql`select id from games where id = ${"demo-next"}`);
  await step("query with a list of ids", () => sql`select id from games where id = any(string_to_array(${"a,b,c"}, ','))`);
  await step("5 queries in a row", async () => {
    for (let i = 0; i < 5; i++) await sql`select ${i}::int as i`;
  });
  await step("5 queries at once", () => Promise.all(Array.from({ length: 5 }, (_, i) => sql`select ${i}::int as i`)));

  const stuck = (await step("look for stuck database sessions", () => sql`
    select pid, state, wait_event_type as waiting_on, round(extract(epoch from now() - coalesce(xact_start, query_start)))::int as seconds,
           left(regexp_replace(query, '\\s+', ' ', 'g'), 70) as query
    from pg_stat_activity
    where datname = current_database() and pid <> pg_backend_pid()
      and backend_type = 'client backend'
      and coalesce(application_name, '') not ilike '%realtime%'
      and query not ilike 'START_REPLICATION%'
      and (state like 'idle in transaction%' or wait_event_type = 'Lock'
           or (state = 'active' and now() - coalesce(xact_start, query_start) > interval '30 seconds'))
    order by 4 desc`)) as { pid: number; state: string; waiting_on: string | null; seconds: number; query: string }[] | undefined;
  if (stuck?.length) {
    console.log(`\n⚠ ${stuck.length} stuck session(s):`);
    console.table(stuck);
  } else if (stuck) {
    console.log("  no stuck sessions");
  }
  console.log("\nDone.");
}

main().finally(() => sql.end({ timeout: 2 }));
