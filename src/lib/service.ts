import "server-only";
import { customAlphabet, nanoid } from "nanoid";
import { db } from "./db";
import {
  computeCharges,
  computeLineup,
  isAvailable,
  suggestKickoffs,
  sumByPayer,
  type AvailSet,
  type SignupLite,
  type WeeklyWindow,
} from "./logic";
import { formatSlot } from "./time";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const gameId = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 8);

// ---------- players ----------

export type PlayerRow = {
  id: string;
  name: string;
  phone: string | null;
  token: string;
  weekly: WeeklyWindow[];
  skill: number | null;
  monzo_username: string | null;
};

export async function playerByToken(token: string | null | undefined) {
  if (!token) return null;
  const [p] = await db()<PlayerRow[]>`select * from players where token = ${token}`;
  return p ?? null;
}

const cleanName = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 40);

/**
 * Identify by name (+ optional phone). If the browser already has a token we
 * update that player; otherwise we match an existing player by name (friends
 * trust each other — this lets you "log in" from a new phone) or create one.
 */
export async function identify(input: { name: string; phone?: string | null; token?: string | null }) {
  const sql = db();
  const name = cleanName(input.name);
  if (!name) throw new HttpError(400, "Name required");
  const phone = input.phone?.replace(/[^\d+]/g, "") || null;
  const existing = await playerByToken(input.token);
  if (existing) {
    const clash = await sql`select id from players where lower(name) = lower(${name}) and id <> ${existing.id}`;
    if (clash.length) throw new HttpError(409, `Someone called "${name}" already exists — add a surname initial?`);
    const [p] = await sql<PlayerRow[]>`
      update players set name = ${name}, phone = coalesce(${phone}, phone), last_seen_at = now()
      where id = ${existing.id} returning *`;
    return p;
  }
  const [byName] = await sql<PlayerRow[]>`select * from players where lower(name) = lower(${name})`;
  if (byName) {
    const [p] = await sql<PlayerRow[]>`
      update players set phone = coalesce(${phone}, phone), last_seen_at = now() where id = ${byName.id} returning *`;
    return p;
  }
  const [p] = await sql<PlayerRow[]>`
    insert into players (name, phone, token) values (${name}, ${phone}, ${nanoid(32)}) returning *`;
  return p;
}

export async function playerByPhone(phone: string) {
  const digits = phone.replace(/[^\d]/g, "");
  const [p] = await db()<PlayerRow[]>`
    select * from players where regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g') = ${digits} limit 1`;
  return p ?? null;
}

export async function updateWeekly(playerId: string, weekly: WeeklyWindow[]) {
  await db()`update players set weekly = ${db().json(weekly)} where id = ${playerId}`;
}

export const publicPlayer = (p: PlayerRow) => ({
  id: p.id,
  name: p.name,
  phone: p.phone,
  weekly: p.weekly,
  monzoUsername: p.monzo_username,
});

// ---------- games ----------

type GameRow = {
  id: string;
  title: string;
  location: string | null;
  maps_url: string | null;
  cost_pence: number;
  cap: number;
  admin_key: string;
  monzo_username: string | null;
  dropout_hours: number;
  status: "open" | "confirmed" | "cancelled";
  confirmed_slot_id: string | null;
  kit: Record<string, string>;
  created_by: string | null;
  created_at: Date;
};
type SlotRow = { id: string; game_id: string; starts_at: Date };
type SignupRow = {
  id: string;
  game_id: string;
  player_id: string | null;
  guest_name: string | null;
  added_by: string | null;
  skill: number | null;
  created_at: Date;
  queued_at: Date | null;
  dropped_at: Date | null;
  dropped_while_in: boolean;
  player_name: string | null;
  player_skill: number | null;
  host_name: string | null;
  phone: string | null;
};

export type CreateGameInput = {
  title: string;
  location?: string;
  mapsUrl?: string;
  costPence: number;
  cap?: number;
  slots: string[]; // ISO instants
  monzoUsername?: string;
  dropoutHours?: number;
};

export async function createGame(input: CreateGameInput, creator: PlayerRow | null) {
  const sql = db();
  const slots = [...new Set(input.slots)].map((s) => new Date(s)).filter((d) => !isNaN(d.getTime()));
  if (!input.title?.trim()) throw new HttpError(400, "Title required");
  if (slots.length < 1 || slots.length > 6) throw new HttpError(400, "Give between 1 and 6 time slots");
  if (!(input.costPence >= 0)) throw new HttpError(400, "Cost required");
  const id = gameId();
  const adminKey = nanoid(24);
  const monzo = input.monzoUsername?.trim().replace(/^@/, "") || creator?.monzo_username || null;
  await sql.begin(async (tx) => {
    await tx`insert into games ${tx({
      id,
      title: input.title.trim().slice(0, 80),
      location: input.location?.trim() || null,
      maps_url: input.mapsUrl?.trim() || null,
      cost_pence: Math.round(input.costPence),
      cap: input.cap && input.cap > 0 ? Math.round(input.cap) : 14,
      admin_key: adminKey,
      monzo_username: monzo,
      dropout_hours: input.dropoutHours ?? 24,
      created_by: creator?.id ?? null,
    })}`;
    for (const d of slots) await tx`insert into slots (game_id, starts_at) values (${id}, ${d})`;
    if (creator && monzo) await tx`update players set monzo_username = ${monzo} where id = ${creator.id}`;
  });
  return { id, adminKey };
}

async function loadGame(id: string) {
  const sql = db();
  const [game] = await sql<GameRow[]>`select * from games where id = ${id}`;
  if (!game) throw new HttpError(404, "Game not found");
  const [slots, signups, avail] = await Promise.all([
    sql<SlotRow[]>`select * from slots where game_id = ${id} order by starts_at`,
    sql<SignupRow[]>`
      select s.*, p.name as player_name, p.skill as player_skill, p.phone, h.name as host_name
      from signups s
      left join players p on p.id = s.player_id
      left join players h on h.id = s.added_by
      where s.game_id = ${id} order by s.created_at`,
    sql<{ slot_id: string; player_id: string }[]>`
      select slot_id, player_id from availability where game_id = ${id} and available`,
  ]);
  return { game, slots, signups, avail };
}

const toLite = (s: SignupRow): SignupLite => ({
  id: s.id,
  playerId: s.player_id,
  addedBy: s.added_by,
  createdAt: s.created_at.toISOString(),
  queuedAt: s.queued_at?.toISOString() ?? null,
  droppedAt: s.dropped_at?.toISOString() ?? null,
  droppedWhileIn: s.dropped_while_in,
});

function compute(data: Awaited<ReturnType<typeof loadGame>>) {
  const { game, slots, signups, avail } = data;
  const availSet: AvailSet = new Set(avail.map((a) => `${a.slot_id}:${a.player_id}`));
  const lites = signups.map(toLite);
  const counts = slots.map((sl) => ({
    id: sl.id,
    count: lites.filter((s) => !s.droppedAt && isAvailable(s, sl.id, availSet)).length,
  }));
  const best = counts.reduce<{ id: string; count: number } | null>((b, c) => (!b || c.count > b.count ? c : b), null);
  const confirmed = game.status === "confirmed" && !!game.confirmed_slot_id;
  const slotId = confirmed ? game.confirmed_slot_id : (best?.id ?? null);
  const lineup = computeLineup(lites, { cap: game.cap, confirmed, slotId, avail: availSet });
  const kickoff = slots.find((s) => s.id === game.confirmed_slot_id)?.starts_at;
  const money =
    confirmed && kickoff
      ? computeCharges(lites, lineup.in.map((s) => s.id), {
          costPence: game.cost_pence,
          cap: game.cap,
          dropoutHours: game.dropout_hours,
          kickoff,
        })
      : null;
  return { availSet, lites, counts, bestSlotId: best && best.count > 0 ? best.id : null, lineup, money, kickoff };
}

/** Running balances: charges from confirmed games minus payments, per player and per game. */
export async function ledger() {
  const sql = db();
  const games = await sql<{ id: string }[]>`select id from games where status = 'confirmed'`;
  const perGame = new Map<string, Map<string, number>>(); // gameId -> payer -> charged
  const datas = await Promise.all(games.map((g) => loadGame(g.id)));
  const meta = new Map<string, { title: string; monzo: string | null; kickoff: Date | undefined }>();
  for (const d of datas) {
    const c = compute(d);
    perGame.set(d.game.id, c.money ? sumByPayer(c.money.charges) : new Map());
    meta.set(d.game.id, { title: d.game.title, monzo: d.game.monzo_username, kickoff: c.kickoff });
  }
  const payments = await sql<{ game_id: string; player_id: string; amount_pence: number }[]>`
    select game_id, player_id, sum(amount_pence)::int as amount_pence from payments group by 1, 2`;
  const paid = new Map(payments.map((p) => [`${p.game_id}:${p.player_id}`, p.amount_pence]));
  return { perGame, paid, meta };
}

export async function getGameState(id: string, opts: { adminKey?: string | null; viewer?: PlayerRow | null } = {}) {
  const data = await loadGame(id);
  const { game, slots, signups } = data;
  const isAdmin = !!opts.adminKey && opts.adminKey === game.admin_key;
  const c = compute(data);
  const sql = db();
  const events = await sql<{ id: string; kind: string; message: string; created_at: Date }[]>`
    select * from events where game_id = ${id} order by created_at desc limit 30`;

  const people = signups.map((s) => ({
    id: s.id,
    playerId: s.player_id,
    name: s.player_id ? s.player_name! : s.guest_name!,
    isGuest: !s.player_id,
    hostId: s.added_by,
    hostName: s.host_name,
    createdAt: s.created_at,
    droppedAt: s.dropped_at,
    skill: s.player_id ? s.player_skill : s.skill,
    phone: isAdmin ? s.phone : undefined,
  }));

  const availability: Record<string, string[]> = {};
  for (const a of data.avail) (availability[a.player_id] ??= []).push(a.slot_id);

  let money = null;
  if (c.money) {
    const { perGame, paid, meta } = await ledger();
    const thisCharges = sumByPayer(c.money.charges);
    const payerIds = new Set([...thisCharges.keys(), ...[...paid.keys()].filter((k) => k.startsWith(id + ":")).map((k) => k.split(":")[1])]);
    const nameOf = new Map(signups.filter((s) => s.player_id).map((s) => [s.player_id!, s.player_name!]));
    const payers = [...payerIds].map((pid) => {
      const thisGame = thisCharges.get(pid) ?? 0;
      const paidThisGame = paid.get(`${id}:${pid}`) ?? 0;
      // Carried: unpaid amounts from other games owed to the same organiser
      let carried = 0;
      for (const [gid, charges] of perGame) {
        if (gid === id || meta.get(gid)?.monzo !== game.monzo_username) continue;
        carried += (charges.get(pid) ?? 0) - (paid.get(`${gid}:${pid}`) ?? 0);
      }
      const mine = c.money!.charges.filter((ch) => ch.payerId === pid);
      return {
        playerId: pid,
        name: nameOf.get(pid) ?? "?",
        thisGame,
        paidThisGame,
        outstanding: thisGame - paidThisGame,
        carried,
        total: thisGame - paidThisGame + carried,
        guests: mine.filter((ch) => people.find((p) => p.id === ch.signupId)?.isGuest).map((ch) => people.find((p) => p.id === ch.signupId)!.name),
        lateDropout: mine.some((ch) => ch.reason === "late-dropout"),
      };
    });
    payers.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    money = { perHead: c.money.perHead, heads: c.money.heads, payers };
  }

  return {
    game: {
      id: game.id,
      title: game.title,
      location: game.location,
      mapsUrl: game.maps_url,
      costPence: game.cost_pence,
      cap: game.cap,
      monzoUsername: game.monzo_username,
      dropoutHours: game.dropout_hours,
      status: game.status,
      confirmedSlotId: game.confirmed_slot_id,
      kickoff: c.kickoff ?? null,
      kit: game.kit,
      createdAt: game.created_at,
    },
    slots: slots.map((s) => ({ id: s.id, startsAt: s.starts_at, count: c.counts.find((x) => x.id === s.id)?.count ?? 0 })),
    bestSlotId: c.bestSlotId,
    people,
    lineup: { in: c.lineup.in.map((s) => s.id), waitlist: c.lineup.waitlist.map((s) => s.id) },
    availability,
    events: events.map((e) => ({ id: String(e.id), kind: e.kind, message: e.message, createdAt: e.created_at })),
    money,
    isAdmin,
    adminKey: isAdmin ? game.admin_key : undefined,
  };
}
export type GameState = Awaited<ReturnType<typeof getGameState>>;

export async function assertAdmin(id: string, key: string | null | undefined) {
  const [g] = await db()<{ admin_key: string }[]>`select admin_key from games where id = ${id}`;
  if (!g) throw new HttpError(404, "Game not found");
  if (!key || key !== g.admin_key) throw new HttpError(403, "Admin key required");
}

async function logEvent(gameId: string, kind: string, message: string) {
  await db()`insert into events (game_id, kind, message) values (${gameId}, ${kind}, ${message})`;
}

/** Run a mutation and log anyone who moved from the waitlist into the lineup. */
async function withLineupDiff(id: string, fn: () => Promise<void>) {
  const before = compute(await loadGame(id));
  await fn();
  const afterData = await loadGame(id);
  const after = compute(afterData);
  if (afterData.game.status !== "confirmed") return;
  const beforeIn = new Set(before.lineup.in.map((s) => s.id));
  const beforeWait = new Set(before.lineup.waitlist.map((s) => s.id));
  for (const s of after.lineup.in) {
    if (!beforeIn.has(s.id) && beforeWait.has(s.id)) {
      const row = afterData.signups.find((x) => x.id === s.id)!;
      await logEvent(id, "promoted", `⬆️ ${row.player_name ?? row.guest_name} bumped up from the waitlist — you're in!`);
    }
  }
}

async function ensureSignup(gameId: string, playerId: string) {
  const sql = db();
  const [s] = await sql<SignupRow[]>`
    insert into signups (game_id, player_id) values (${gameId}, ${playerId})
    on conflict (game_id, player_id) where player_id is not null do update set player_id = excluded.player_id
    returning *`;
  return s;
}

export async function setAvailability(
  gameId: string,
  player: PlayerRow,
  input: { available: string[]; weekly?: WeeklyWindow[] | null },
) {
  const sql = db();
  const { game, slots } = await loadGame(gameId);
  if (game.status === "cancelled") throw new HttpError(400, "Game cancelled");
  const avail = new Set(input.available);
  await withLineupDiff(gameId, async () => {
    const signup = await ensureSignup(gameId, player.id);
    for (const sl of slots) {
      await sql`
        insert into availability (game_id, slot_id, player_id, available, updated_at)
        values (${gameId}, ${sl.id}, ${player.id}, ${avail.has(sl.id)}, now())
        on conflict (slot_id, player_id) do update set available = excluded.available, updated_at = now()`;
    }
    if (game.status === "confirmed" && game.confirmed_slot_id) {
      const freeForConfirmed = avail.has(game.confirmed_slot_id);
      const queued = signup.queued_at && !signup.dropped_at;
      if (freeForConfirmed && !queued) await joinQueue(gameId, signup.id);
      if (!freeForConfirmed && queued) await dropSignup(gameId, signup.id);
    }
    if (input.weekly) await updateWeekly(player.id, input.weekly);
  });
}

async function joinQueue(gameId: string, signupId: string) {
  await db()`update signups set queued_at = now(), dropped_at = null, dropped_while_in = false where id = ${signupId}`;
  const [row] = await db()<{ n: string }[]>`
    select coalesce(p.name, s.guest_name) as n from signups s left join players p on p.id = s.player_id where s.id = ${signupId}`;
  await logEvent(gameId, "joined", `➕ ${row.n} joined`);
}

/** Internal: mark dropped, remembering whether they were in the lineup (for the late-dropout rule). */
async function dropSignup(gameId: string, signupId: string) {
  const data = await loadGame(gameId);
  const c = compute(data);
  const wasIn = c.lineup.in.some((s) => s.id === signupId);
  await db()`update signups set dropped_at = now(), dropped_while_in = ${wasIn} where id = ${signupId} and game_id = ${gameId}`;
  const row = data.signups.find((s) => s.id === signupId);
  if (row) await logEvent(gameId, "dropped", `❌ ${row.player_name ?? row.guest_name} dropped out`);
}

async function signupFor(gameId: string, signupId: string) {
  const [s] = await db()<SignupRow[]>`select * from signups where id = ${signupId} and game_id = ${gameId}`;
  if (!s) throw new HttpError(404, "Signup not found");
  return s;
}

/** Drop out (player for themselves/their guests, or admin for anyone). */
export async function dropOut(gameId: string, signupId: string, actor: { player?: PlayerRow | null; admin?: boolean }) {
  const s = await signupFor(gameId, signupId);
  if (!actor.admin && s.player_id !== actor.player?.id && s.added_by !== actor.player?.id)
    throw new HttpError(403, "You can only drop yourself or your guests");
  if (s.dropped_at) return;
  await withLineupDiff(gameId, async () => {
    await dropSignup(gameId, signupId);
    if (s.player_id && s.player_id === actor.player?.id) {
      const [g] = await db()<GameRow[]>`select * from games where id = ${gameId}`;
      if (g.confirmed_slot_id)
        await db()`update availability set available = false where slot_id = ${g.confirmed_slot_id} and player_id = ${s.player_id}`;
    }
  });
}

export async function rejoin(gameId: string, signupId: string, actor: { player?: PlayerRow | null; admin?: boolean }) {
  const s = await signupFor(gameId, signupId);
  if (!actor.admin && s.player_id !== actor.player?.id && s.added_by !== actor.player?.id)
    throw new HttpError(403, "Not yours");
  const [g] = await db()<GameRow[]>`select * from games where id = ${gameId}`;
  await withLineupDiff(gameId, async () => {
    if (s.player_id && g.confirmed_slot_id) {
      await db()`
        insert into availability (game_id, slot_id, player_id, available) values (${gameId}, ${g.confirmed_slot_id}, ${s.player_id}, true)
        on conflict (slot_id, player_id) do update set available = true, updated_at = now()`;
    }
    if (g.status === "confirmed") await joinQueue(gameId, signupId);
    else await db()`update signups set dropped_at = null, dropped_while_in = false where id = ${signupId}`;
  });
}

export async function addGuest(gameId: string, host: PlayerRow, guestName: string) {
  const name = cleanName(guestName);
  if (!name) throw new HttpError(400, "Guest name required");
  const { game } = await loadGame(gameId);
  await withLineupDiff(gameId, async () => {
    await ensureSignup(gameId, host.id); // host must be part of the game to bring a guest
    await db()`
      insert into signups (game_id, guest_name, added_by, queued_at)
      values (${gameId}, ${name}, ${host.id}, ${game.status === "confirmed" ? new Date() : null})`;
    await logEvent(gameId, "guest", `👋 ${host.name} added ${name}`);
  });
}

export async function confirmSlot(gameId: string, slotId: string) {
  const sql = db();
  const data = await loadGame(gameId);
  const slot = data.slots.find((s) => s.id === slotId);
  if (!slot) throw new HttpError(400, "Unknown slot");
  const availSet: AvailSet = new Set(data.avail.map((a) => `${a.slot_id}:${a.player_id}`));
  await sql.begin(async (tx) => {
    await tx`update games set status = 'confirmed', confirmed_slot_id = ${slotId} where id = ${gameId}`;
    await tx`update signups set queued_at = null where game_id = ${gameId}`;
    for (const s of data.signups) {
      if (!s.dropped_at && isAvailable(toLite(s), slotId, availSet)) {
        await tx`update signups set queued_at = created_at where id = ${s.id}`;
      }
    }
  });
  await logEvent(gameId, "confirmed", `✅ Confirmed for ${formatSlot(slot.starts_at)}`);
}

export async function updateGame(
  gameId: string,
  patch: Partial<{ title: string; location: string; mapsUrl: string; costPence: number; cap: number; monzoUsername: string; dropoutHours: number; status: "open" | "cancelled" }>,
) {
  const sql = db();
  const map: Record<string, unknown> = {};
  if (patch.title !== undefined) map.title = patch.title.trim().slice(0, 80);
  if (patch.location !== undefined) map.location = patch.location.trim() || null;
  if (patch.mapsUrl !== undefined) map.maps_url = patch.mapsUrl.trim() || null;
  if (patch.costPence !== undefined) map.cost_pence = Math.max(0, Math.round(patch.costPence));
  if (patch.cap !== undefined) map.cap = Math.max(1, Math.round(patch.cap));
  if (patch.monzoUsername !== undefined) map.monzo_username = patch.monzoUsername.trim().replace(/^@/, "") || null;
  if (patch.dropoutHours !== undefined) map.dropout_hours = Math.max(0, Math.round(patch.dropoutHours));
  if (patch.status === "cancelled") map.status = "cancelled";
  if (patch.status === "open") Object.assign(map, { status: "open", confirmed_slot_id: null });
  if (!Object.keys(map).length) return;
  await withLineupDiff(gameId, async () => {
    await sql`update games set ${sql(map)} where id = ${gameId}`;
    if (map.monzo_username) {
      await sql`update players set monzo_username = ${map.monzo_username as string}
        where id = (select created_by from games where id = ${gameId})`;
    }
  });
}

/** Tick paid: records payments covering this game plus carried debt to the same organiser. */
export async function setPaid(gameId: string, playerId: string, paid: boolean) {
  const sql = db();
  const [game] = await sql<GameRow[]>`select * from games where id = ${gameId}`;
  if (!paid) {
    await sql`delete from payments where game_id = ${gameId} and player_id = ${playerId}`;
    return;
  }
  const { perGame, paid: paidMap, meta } = await ledger();
  for (const [gid, charges] of perGame) {
    if (gid !== gameId && meta.get(gid)?.monzo !== game.monzo_username) continue;
    const owed = (charges.get(playerId) ?? 0) - (paidMap.get(`${gid}:${playerId}`) ?? 0);
    if (owed > 0) await sql`insert into payments (game_id, player_id, amount_pence) values (${gid}, ${playerId}, ${owed})`;
  }
}

export async function setSkill(gameId: string, signupId: string, skill: number | null) {
  const s = await signupFor(gameId, signupId);
  const v = skill && skill >= 1 && skill <= 5 ? Math.round(skill) : null;
  if (s.player_id) await db()`update players set skill = ${v} where id = ${s.player_id}`;
  else await db()`update signups set skill = ${v} where id = ${signupId}`;
}

export async function setKit(gameId: string, duty: string, signupId: string | null, actor: { player?: PlayerRow | null; admin?: boolean }) {
  if (!["ball", "bibs"].includes(duty)) throw new HttpError(400, "Unknown duty");
  if (signupId) {
    const s = await signupFor(gameId, signupId);
    if (!actor.admin && s.player_id !== actor.player?.id) throw new HttpError(403, "Not yours");
  }
  const sql = db();
  if (signupId) await sql`update games set kit = kit || ${sql.json({ [duty]: signupId })} where id = ${gameId}`;
  else await sql`update games set kit = kit - ${duty} where id = ${gameId}`;
}

export async function listGames(opts: { upcomingOnly?: boolean; limit?: number } = {}) {
  const rows = await db()<{ id: string; title: string; status: string; location: string | null; first_slot: Date | null; kickoff: Date | null; created_at: Date }[]>`
    select g.id, g.title, g.status, g.location, g.created_at,
      (select min(starts_at) from slots s where s.game_id = g.id) as first_slot,
      (select starts_at from slots s where s.id = g.confirmed_slot_id) as kickoff
    from games g
    where g.status <> 'cancelled'
    order by g.created_at desc limit ${opts.limit ?? 20}`;
  const now = Date.now();
  return rows
    .filter((r) => !opts.upcomingOnly || ((r.kickoff ?? r.first_slot)?.getTime() ?? 0) > now - 3 * 3600_000)
    .map((r) => ({ id: r.id, title: r.title, status: r.status, location: r.location, kickoff: r.kickoff, firstSlot: r.first_slot }));
}

export async function balances() {
  const { perGame, paid, meta } = await ledger();
  const players = await db()<{ id: string; name: string }[]>`select id, name from players`;
  const out = players.map((p) => {
    const games: { gameId: string; title: string; charged: number; paid: number }[] = [];
    for (const [gid, charges] of perGame) {
      const charged = charges.get(p.id) ?? 0;
      const pd = paid.get(`${gid}:${p.id}`) ?? 0;
      if (charged || pd) games.push({ gameId: gid, title: meta.get(gid)!.title, charged, paid: pd });
    }
    const owed = games.reduce((s, g) => s + g.charged - g.paid, 0);
    return { playerId: p.id, name: p.name, owed, games };
  });
  return out.filter((b) => b.games.length).sort((a, b) => b.owed - a.owed || a.name.localeCompare(b.name));
}

export async function kickoffSuggestions() {
  const rows = await db()<{ weekly: WeeklyWindow[] }[]>`
    select weekly from players
    where jsonb_array_length(weekly) > 0 and last_seen_at > now() - interval '90 days'`;
  return suggestKickoffs(rows.map((r) => r.weekly), new Date());
}

export async function checkRateLimit(key: string, limit = 10) {
  const sql = db();
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from ai_requests where key = ${key} and created_at > now() - interval '1 hour'`;
  if (n >= limit) return false;
  await sql`insert into ai_requests (key) values (${key})`;
  if (Math.random() < 0.02) await sql`delete from ai_requests where created_at < now() - interval '1 day'`;
  return true;
}

export async function slotsForGame(gameId: string) {
  return db()<SlotRow[]>`select * from slots where game_id = ${gameId} order by starts_at`;
}
