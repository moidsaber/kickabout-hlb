// Seed a demo: 16 players (most with a usual week), an open game with 4 candidate
// slots and ~12 responses, and a past confirmed game with some unpaid shares so
// running balances / carry-over show up.
//
//   npm run seed            (uses DATABASE_URL from .env.local / env)
//
// Safe to re-run: only removes rows it created (games "demo-*", players with "seed-" tokens).
import postgres from "postgres";
import { londonToUtc, londonDate } from "../src/lib/time";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL");
const local = /localhost|127\.0\.0\.1/.test(url);
const sql = postgres(url, { prepare: false, ssl: local ? false : "require", max: 1 });

type W = { day: string; start: string; end: string };
const weekdayEvenings: W[] = ["mon", "tue", "wed", "thu", "fri"].map((day) => ({ day, start: "18:00", end: "22:00" }));
const weekends: W[] = [
  { day: "sat", start: "09:00", end: "22:00" },
  { day: "sun", start: "09:00", end: "22:00" },
];

const players: { name: string; phone?: string; weekly: W[]; skill?: number }[] = [
  { name: "Moid", phone: "+447700900001", weekly: [...weekdayEvenings, weekends[0]], skill: 4 },
  { name: "Jamal", phone: "+447700900002", weekly: weekdayEvenings, skill: 5 },
  { name: "Tom", weekly: [{ day: "tue", start: "18:30", end: "22:00" }, { day: "thu", start: "18:30", end: "22:00" }], skill: 3 },
  { name: "Priya", weekly: [...weekdayEvenings, ...weekends], skill: 4 },
  { name: "Dan", weekly: [{ day: "thu", start: "19:00", end: "22:00" }], skill: 2 },
  { name: "Kwame", weekly: weekends, skill: 5 },
  { name: "Leo", weekly: [{ day: "wed", start: "18:00", end: "22:00" }, { day: "thu", start: "18:00", end: "22:00" }], skill: 3 },
  { name: "Sophie", weekly: [...weekdayEvenings.filter((w) => w.day !== "fri")], skill: 3 },
  { name: "Ravi", weekly: [{ day: "sat", start: "09:00", end: "13:00" }, { day: "thu", start: "19:00", end: "22:00" }], skill: 4 },
  { name: "Ben", weekly: weekdayEvenings, skill: 2 },
  { name: "Callum", weekly: [{ day: "mon", start: "19:00", end: "22:00" }, { day: "thu", start: "19:00", end: "22:00" }] },
  { name: "Ola", weekly: [] },
  { name: "Marco", weekly: [], skill: 4 },
  { name: "Hannah", weekly: [] },
  { name: "Seb", weekly: [] },
  { name: "Yusuf", weekly: [] },
];

function nextDay(dow: number, time: string, weeksAhead = 0) {
  // dow: 0=Mon..6=Sun (London)
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  for (let off = 1; off <= 8; off++) {
    const d = new Date(Date.now() + (off + weeksAhead * 7) * 86400_000);
    const wd = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" }).format(d);
    if (wd === names[dow]) return londonToUtc(`${londonDate(d)}T${time}`);
  }
  throw new Error("unreachable");
}

async function main() {
  await sql`delete from games where id like 'demo-%'`;
  await sql`delete from players where token like 'seed-%'`;

  const ids: Record<string, string> = {};
  for (const [i, p] of players.entries()) {
    const [row] = await sql`
      insert into players (name, phone, token, weekly, skill, last_seen_at)
      values (${p.name}, ${p.phone ?? null}, ${"seed-" + i + "-" + Math.random().toString(36).slice(2)}, ${sql.json(p.weekly)}, ${p.skill ?? null}, now())
      on conflict ((lower(name))) do update set weekly = excluded.weekly, token = excluded.token
      returning id`;
    ids[p.name] = row.id;
  }
  await sql`update players set monzo_username = 'moidsaber' where id = ${ids.Moid}`;

  // ---- Past confirmed game (last week) with some unpaid shares ----
  const pastKick = new Date(Date.now() - 6 * 86400_000);
  const past = "demo-past";
  await sql`insert into games (id, title, location, maps_url, cost_pence, cap, admin_key, monzo_username, status, created_by)
    values (${past}, 'Last Thursday 7s', 'Powerleague Shoreditch', 'https://maps.app.goo.gl/example', 8400, 14, 'demo-past-admin-key', 'moidsaber', 'confirmed', ${ids.Moid})`;
  const [ps] = await sql`insert into slots (game_id, starts_at) values (${past}, ${pastKick}) returning id`;
  await sql`update games set confirmed_slot_id = ${ps.id} where id = ${past}`;
  const pastPlayers = players.slice(0, 14).map((p) => p.name);
  for (const [i, n] of pastPlayers.entries()) {
    const t = new Date(pastKick.getTime() - 5 * 86400_000 + i * 60_000);
    await sql`insert into availability (game_id, slot_id, player_id, available) values (${past}, ${ps.id}, ${ids[n]}, true)`;
    await sql`insert into signups (game_id, player_id, created_at, queued_at) values (${past}, ${ids[n]}, ${t}, ${t})`;
  }
  // 84.00 / 14 = 6.00 each. Everyone paid except Tom, Dan, Ola.
  for (const n of pastPlayers.filter((n) => !["Tom", "Dan", "Ola"].includes(n))) {
    await sql`insert into payments (game_id, player_id, amount_pence) values (${past}, ${ids[n]}, 600)`;
  }

  // ---- Upcoming open game: 4 candidate slots, 12 responses ----
  const g = "demo-next";
  await sql`insert into games (id, title, location, maps_url, cost_pence, cap, admin_key, monzo_username, created_by)
    values (${g}, 'Thursday 7s', 'Powerleague Shoreditch', 'https://maps.app.goo.gl/example', 8400, 14, 'demo-admin-key', 'moidsaber', ${ids.Moid})`;
  const slotTimes = [nextDay(1, "19:00"), nextDay(3, "19:00"), nextDay(3, "20:00"), nextDay(5, "10:00")];
  const slotIds: string[] = [];
  for (const t of slotTimes) {
    const [r] = await sql`insert into slots (game_id, starts_at) values (${g}, ${t}) returning id`;
    slotIds.push(r.id);
  }
  // Thursday 19:00 (index 1) should come out most popular
  const responses: [string, number[]][] = [
    ["Moid", [0, 1, 2, 3]],
    ["Jamal", [0, 1, 2]],
    ["Tom", [0, 1, 2]],
    ["Priya", [0, 1, 2, 3]],
    ["Dan", [1, 2]],
    ["Kwame", [3]],
    ["Leo", [1, 2]],
    ["Sophie", [0, 1]],
    ["Ravi", [1, 2, 3]],
    ["Ben", [0, 1, 2]],
    ["Callum", [1]],
    ["Marco", [1, 3]],
  ];
  for (const [i, [n, avail]] of responses.entries()) {
    const t = new Date(Date.now() - (responses.length - i) * 3600_000);
    await sql`insert into signups (game_id, player_id, created_at) values (${g}, ${ids[n]}, ${t})`;
    for (const [si, sid] of slotIds.entries()) {
      await sql`insert into availability (game_id, slot_id, player_id, available) values (${g}, ${sid}, ${ids[n]}, ${avail.includes(si)})`;
    }
  }
  // Moid brings a mate
  await sql`insert into signups (game_id, guest_name, added_by, created_at) values (${g}, 'Sam', ${ids.Moid}, now() - interval '30 minutes')`;

  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  console.log(`Seeded ${players.length} players and 2 games.

  Player link:     ${base}/g/${g}
  Organiser link:  ${base}/g/${g}/admin?key=demo-admin-key
  Past game admin: ${base}/g/${past}/admin?key=demo-past-admin-key
  Balances:        ${base}/balances

Tip: on the player link, enter a seeded name (e.g. "Ola" — no response yet, or "Hannah") to test as them.`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
