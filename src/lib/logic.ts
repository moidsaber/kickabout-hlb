// Pure business logic (no DB) so it's easy to unit-test and reuse from a bot.
import { DAYS, type Day, londonDate, londonHHMM, londonParts, londonToUtc, DAY_LABEL } from "./time";

export type WeeklyWindow = { day: Day; start: string; end: string };

export interface SignupLite {
  id: string;
  playerId: string | null; // null => guest
  addedBy: string | null; // host player id for guests
  createdAt: string;
  queuedAt: string | null;
  droppedAt: string | null;
  droppedWhileIn: boolean;
}

/** Set of `${slotId}:${playerId}` for available=true rows */
export type AvailSet = Set<string>;

export function isAvailable(s: SignupLite, slotId: string, avail: AvailSet) {
  const who = s.playerId ?? s.addedBy; // guests go when their host can
  return !!who && avail.has(`${slotId}:${who}`);
}

/**
 * Lineup:
 * - before confirmation: preview for a slot, ordered by first response time
 * - after confirmation: frozen queue order (queued_at); dropping removes you,
 *   so the first waitlisted person moves up automatically.
 */
export function computeLineup<T extends SignupLite>(
  signups: T[],
  opts: { cap: number; confirmed: boolean; slotId: string | null; avail: AvailSet },
) {
  let eligible: T[];
  if (opts.confirmed) {
    eligible = signups
      .filter((s) => s.queuedAt && !s.droppedAt)
      .sort((a, b) => cmp(a.queuedAt!, b.queuedAt!) || cmp(a.createdAt, b.createdAt));
  } else if (opts.slotId) {
    eligible = signups
      .filter((s) => !s.droppedAt && isAvailable(s, opts.slotId!, opts.avail))
      .sort((a, b) => cmp(a.createdAt, b.createdAt));
  } else {
    eligible = [];
  }
  return { in: eligible.slice(0, opts.cap), waitlist: eligible.slice(opts.cap) };
}

const cmp = (a: string, b: string) => new Date(a).getTime() - new Date(b).getTime();

/** Round up to the nearest 10p */
export const roundUp10 = (pence: number) => Math.ceil(pence / 10) * 10;

export interface Charge {
  signupId: string;
  payerId: string; // player responsible
  pence: number;
  reason: "playing" | "late-dropout";
}

/**
 * Who owes what for one game.
 * Late dropouts (dropped while "in", within dropoutHours of kick-off) still owe
 * if their spot wasn't filled. Spots are refilled in drop order, so the most
 * recent unreplaced droppers are the ones who owe.
 */
export function computeCharges(
  signups: SignupLite[],
  inIds: string[],
  game: { costPence: number; cap: number; dropoutHours: number; kickoff: Date },
) {
  const cutoff = game.kickoff.getTime() - game.dropoutHours * 3600_000;
  const late = signups
    .filter((s) => s.droppedAt && s.droppedWhileIn && new Date(s.droppedAt).getTime() >= cutoff)
    .sort((a, b) => cmp(b.droppedAt!, a.droppedAt!)); // most recent first
  const vacancies = Math.max(0, game.cap - inIds.length);
  const owingDroppers = late.slice(0, vacancies);
  const heads = inIds.length + owingDroppers.length;
  const perHead = heads ? roundUp10(game.costPence / heads) : 0;
  const byId = new Map(signups.map((s) => [s.id, s]));
  const charges: Charge[] = [];
  for (const id of inIds) {
    const s = byId.get(id)!;
    const payerId = s.playerId ?? s.addedBy;
    if (payerId) charges.push({ signupId: id, payerId, pence: perHead, reason: "playing" });
  }
  for (const s of owingDroppers) {
    const payerId = s.playerId ?? s.addedBy;
    if (payerId) charges.push({ signupId: s.id, payerId, pence: perHead, reason: "late-dropout" });
  }
  return { perHead, heads, charges };
}

export function sumByPayer(charges: Charge[]) {
  const m = new Map<string, number>();
  for (const c of charges) m.set(c.payerId, (m.get(c.payerId) ?? 0) + c.pence);
  return m;
}

/** Does a stored weekly pattern cover this kick-off time? */
export function weeklyCovers(weekly: WeeklyWindow[] | null | undefined, startsAt: Date) {
  if (!weekly?.length) return false;
  const p = londonParts(startsAt);
  const t = londonHHMM(startsAt);
  return weekly.some((w) => w.day === p.weekday && w.start <= t && t < w.end);
}

/** Top kick-off suggestions from recent players' weekly availability. */
export function suggestKickoffs(weeklies: WeeklyWindow[][], now: Date, count = 3) {
  const candidates: { day: Day; time: string; n: number }[] = [];
  for (const day of DAYS) {
    for (let mins = 9 * 60; mins <= 21 * 60; mins += 30) {
      const time = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${mins % 60 ? "30" : "00"}`;
      // The whole hour must fit inside the player's window
      const n = weeklies.filter((w) => w.some((x) => x.day === day && toMin(x.start) <= mins && mins + 60 <= toMin(x.end))).length;
      if (n > 0) candidates.push({ day, time, n });
    }
  }
  // Most players first; ties go to the time closest to a classic 19:00 kick-off
  const pref = (t: string) => Math.abs(toMin(t) - 19 * 60);
  candidates.sort((a, b) => b.n - a.n || pref(a.time) - pref(b.time));
  const picked: typeof candidates = [];
  // First pass: one per day. Second pass: allow same day if at least 2h apart.
  for (const c of candidates) if (picked.length < count && !picked.some((p) => p.day === c.day)) picked.push(c);
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (picked.some((p) => p.day === c.day && Math.abs(toMin(p.time) - toMin(c.time)) < 120)) continue;
    picked.push(c);
  }
  picked.sort((a, b) => b.n - a.n);
  return picked.map((c) => {
    const date = nextDateFor(c.day, now);
    const local = `${date}T${c.time}`;
    return { local, startsAt: londonToUtc(local).toISOString(), label: `${DAY_LABEL[c.day]} ${c.time}`, available: c.n };
  });
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Next London date (tomorrow onwards) that falls on `day` */
function nextDateFor(day: Day, now: Date) {
  for (let off = 1; off <= 7; off++) {
    const d = new Date(now.getTime() + off * 86400_000);
    if (londonParts(d).weekday === day) return londonDate(d);
  }
  return londonDate(now);
}

export const gbp = (pence: number) => `£${(pence / 100).toFixed(2)}`;

export function monzoLink(username: string, pence: number, note?: string) {
  const u = username.replace(/^@/, "").replace(/^https?:\/\/monzo\.me\//, "").replace(/\/.*$/, "");
  const q = note ? `?d=${encodeURIComponent(note)}` : "";
  return `https://monzo.me/${encodeURIComponent(u)}/${(pence / 100).toFixed(2)}${q}`;
}

/** Simple team picker: balanced (snake draft by skill) or random. */
export function pickTeams<T extends { skill: number }>(people: T[], mode: "balanced" | "random", rand = Math.random) {
  const shuffled = [...people].sort(() => rand() - 0.5);
  const a: T[] = [];
  const b: T[] = [];
  if (mode === "random") {
    shuffled.forEach((p, i) => (i % 2 ? b : a).push(p));
  } else {
    const sorted = shuffled.sort((x, y) => y.skill - x.skill);
    // Greedy: add each player to the weaker (then smaller) team
    for (const p of sorted) {
      const sa = a.reduce((s, x) => s + x.skill, 0);
      const sb = b.reduce((s, x) => s + x.skill, 0);
      if (a.length >= Math.ceil(sorted.length / 2)) b.push(p);
      else if (b.length >= Math.ceil(sorted.length / 2)) a.push(p);
      else (sa <= sb ? a : b).push(p);
    }
  }
  return [a, b];
}

// ---------- kick-off candidates (game setup) ----------

export type DayOption = { date: string; day: Day; label: string; isToday: boolean };

/** The next `n` London calendar days starting today, e.g. {date:"2026-10-31", day:"sat", label:"Sat 31"}. */
export function nextDays(now: Date, n = 7): DayOption[] {
  const [y, m, d] = londonDate(now).split("-").map(Number);
  const out: DayOption[] = [];
  for (let off = 0; off < n; off++) {
    const u = new Date(Date.UTC(y, m - 1, d + off, 12)); // calendar arithmetic only
    const date = u.toISOString().slice(0, 10);
    const day = DAYS[(u.getUTCDay() + 6) % 7];
    out.push({ date, day, label: `${DAY_LABEL[day]} ${u.getUTCDate()}`, isToday: off === 0 });
  }
  return out;
}

/** Every chosen date × time, skipping anything starting within 15 minutes. Sorted, de-duplicated. */
export function combineDaysTimes(dates: string[], times: string[], now: Date) {
  const seen = new Set<string>();
  const out: { local: string; startsAt: string }[] = [];
  for (const date of dates) {
    for (const time of times) {
      if (!/^\d{2}:\d{2}$/.test(time)) continue;
      const local = `${date}T${time}`;
      if (seen.has(local)) continue;
      const at = londonToUtc(local);
      if (at.getTime() < now.getTime() + 15 * 60_000) continue;
      seen.add(local);
      out.push({ local, startsAt: at.toISOString() });
    }
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Pick the `n` times most regulars are usually free for (ties -> earliest). */
export function pickBest<T extends { local: string; available: number }>(cands: T[], n = 3) {
  return [...cands].sort((a, b) => b.available - a.available || a.local.localeCompare(b.local)).slice(0, n).map((c) => c.local);
}
