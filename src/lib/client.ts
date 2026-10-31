"use client";
// Browser-side helpers: remembered identity + typed fetch wrapper.

export type Me = { id: string; name: string; phone: string | null; weekly: { day: string; start: string; end: string }[]; monzoUsername?: string | null };

const K = { token: "kick.token", me: "kick.me", games: "kick.games", monzo: "kick.monzo", organiser: "kick.organiser" };

function read<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

export const store = {
  token: () => read<string | null>(K.token, null),
  me: () => read<Me | null>(K.me, null),
  setMe(me: Me, token: string) {
    write(K.me, me);
    write(K.token, token);
  },
  updateMe(patch: Partial<Me>) {
    const me = read<Me | null>(K.me, null);
    if (me) write(K.me, { ...me, ...patch });
  },
  forget() {
    try {
      localStorage.removeItem(K.me);
      localStorage.removeItem(K.token);
    } catch {}
  },
  games: () => read<{ id: string; title: string; adminKey?: string }[]>(K.games, []),
  rememberGame(g: { id: string; title: string; adminKey?: string }) {
    const list = read<{ id: string; title: string; adminKey?: string }[]>(K.games, []);
    const prev = list.find((x) => x.id === g.id);
    const next = [{ ...prev, ...g, adminKey: g.adminKey ?? prev?.adminKey }, ...list.filter((x) => x.id !== g.id)].slice(0, 20);
    write(K.games, next);
  },
  organiserCode: () => read<string | null>(K.organiser, null),
  setOrganiserCode: (c: string) => write(K.organiser, c),
  forgetOrganiserCode() {
    try {
      localStorage.removeItem(K.organiser);
    } catch {}
  },
  monzo: () => read<string>(K.monzo, ""),
  setMonzo: (u: string) => write(K.monzo, u),
};

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; adminKey?: string | null; timeoutMs?: number } = {},
): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = store.token();
  if (token) headers["x-player-token"] = token;
  if (opts.adminKey) headers["x-admin-key"] = opts.adminKey;
  const organiser = store.organiserCode();
  if (organiser) headers["x-organiser-code"] = organiser;
  // Never spin forever: give up with a clear message
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ApiError(
      (e as Error).name === "AbortError" ? "This is taking too long — check your connection and try again." : "Couldn't reach the server — check your connection.",
      0,
    );
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export async function identify(name: string, phone?: string) {
  const r = await api<{ player: Me; token: string }>("/api/v1/players", { body: { name, phone } });
  store.setMe(r.player, r.token);
  return r.player;
}
