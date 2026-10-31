"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, store, type Me } from "@/lib/client";
import type { GameState } from "@/lib/service";
import { gbp, monzoLink, weeklyCovers, type WeeklyWindow } from "@/lib/logic";
import { DAY_LABEL, formatSlot, type Day } from "@/lib/time";
import { Button, Card, ErrorNote, inputCls } from "./ui";
import { MAX_TEXT } from "@/lib/limits";
import { NameForm } from "./NameForm";

type Parsed = {
  slots: { slotId: string; available: boolean; confidence: "high" | "low" }[];
  weekly: WeeklyWindow[];
  notes: string;
};

export function useGame(id: string, adminKey?: string | null) {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const s = await api<GameState>(`/api/v1/games/${id}${adminKey ? `?key=${encodeURIComponent(adminKey)}` : ""}`);
      setState(s);
      setError(null);
      store.rememberGame({ id, title: s.game.title, adminKey: s.isAdmin ? adminKey! : undefined });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, adminKey]);
  useEffect(() => {
    reload();
    const t = setInterval(reload, 30_000);
    return () => clearInterval(t);
  }, [reload]);
  return { state, error, reload };
}

export function GameHeader({ s }: { s: GameState }) {
  const g = s.game;
  return (
    <header className="space-y-1">
      <h1 className="text-2xl font-bold">{g.title}</h1>
      {g.status === "confirmed" && g.kickoff && (
        <p className="text-lg font-semibold text-emerald-700">✅ {formatSlot(g.kickoff)}</p>
      )}
      {g.status === "cancelled" && <p className="font-semibold text-rose-700">❌ Cancelled</p>}
      {g.location && (
        <p className="text-slate-700">
          📍 {g.location}{" "}
          {g.mapsUrl && (
            <a href={g.mapsUrl} target="_blank" rel="noreferrer" className="text-emerald-700 underline">
              Map
            </a>
          )}
        </p>
      )}
      <p className="text-sm text-slate-600">
        💷 {gbp(g.costPence)} pitch · max {g.cap} players
        {s.money ? ` · ${gbp(s.money.perHead)} each` : ""}
      </p>
    </header>
  );
}

export function GameView({ id }: { id: string }) {
  const { state: s, error, reload } = useGame(id);
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setMe(store.me());
    setReady(true);
  }, []);

  if (error && !s) return <p className="p-4 text-rose-700">{error}</p>;
  if (!s || !ready) return <p className="p-4 text-slate-500">Loading…</p>;

  const mySignup = me ? s.people.find((p) => p.playerId === me.id) : undefined;
  const confirmed = s.game.status === "confirmed";

  return (
    <div className="space-y-4">
      <GameHeader s={s} />
      <Events s={s} />
      {!me ? (
        <Card title="Who are you?">
          <NameForm onDone={(p) => setMe(p)} />
        </Card>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            Hi {me.name} 👋{" "}
            <button
              className="text-emerald-700 underline"
              onClick={() => {
                store.forget();
                setMe(null);
              }}
            >
              Not you?
            </button>
          </p>
          {confirmed && <MyStatus s={s} me={me} reload={reload} />}
          {s.game.status !== "cancelled" && <Availability key={me.id + (mySignup ? "1" : "0")} s={s} me={me} reload={reload} />}
          {confirmed && <Payment s={s} me={me} />}
          {s.game.status !== "cancelled" && <Guests s={s} me={me} reload={reload} />}
          {confirmed && <Kit s={s} me={me} reload={reload} />}
        </>
      )}
      <Lineup s={s} />
      <p className="pt-4 text-center text-xs text-slate-400">
        <Link href="/">Kickabout</Link> · <Link href="/balances">Balances</Link>
      </p>
    </div>
  );
}

function Events({ s }: { s: GameState }) {
  const recent = s.events.filter((e) => e.kind === "promoted" && Date.now() - new Date(e.createdAt).getTime() < 3 * 86400_000);
  if (!recent.length) return null;
  return (
    <div className="space-y-2">
      {recent.slice(0, 3).map((e) => (
        <div key={e.id} className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          {e.message}
        </div>
      ))}
    </div>
  );
}

function MyStatus({ s, me, reload }: { s: GameState; me: Me; reload: () => Promise<void> }) {
  const mine = s.people.find((p) => p.playerId === me.id);
  const [err, setErr] = useState<string | null>(null);
  if (!mine) return null;
  const inIdx = s.lineup.in.indexOf(mine.id);
  const waitIdx = s.lineup.waitlist.indexOf(mine.id);
  const kickoff = s.game.kickoff ? new Date(s.game.kickoff).getTime() : 0;
  const late = kickoff && kickoff - Date.now() < s.game.dropoutHours * 3600_000;
  const act = async (rejoin: boolean) => {
    if (!rejoin && late && inIdx >= 0 && !confirm(`It's within ${s.game.dropoutHours}h of kick-off — if nobody takes your spot you'll still owe your share. Drop out?`)) return;
    try {
      await api(`/api/v1/games/${s.game.id}/drop`, { body: { signupId: mine.id, rejoin } });
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Card>
      {inIdx >= 0 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-lg font-semibold text-emerald-700">You&apos;re in ⚽</p>
          <Button variant="danger" onClick={() => act(false)}>
            Drop out
          </Button>
        </div>
      ) : waitIdx >= 0 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold text-amber-700">You&apos;re #{waitIdx + 1} on the waitlist</p>
          <Button variant="danger" onClick={() => act(false)}>
            Leave waitlist
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-slate-700">You&apos;re not playing{mine.droppedAt ? " (dropped out)" : ""}.</p>
          <Button onClick={() => act(true)}>I can play</Button>
        </div>
      )}
      <ErrorNote error={err} />
    </Card>
  );
}

function Availability({ s, me, reload }: { s: GameState; me: Me; reload: () => Promise<void> }) {
  const responded = s.people.some((p) => p.playerId === me.id);
  const initial = useMemo(() => {
    if (responded) return { ticks: new Set(s.availability[me.id] ?? []), fromWeekly: false };
    const t = new Set(s.slots.filter((sl) => weeklyCovers(me.weekly as WeeklyWindow[], new Date(sl.startsAt))).map((sl) => sl.id));
    return { ticks: t, fromWeekly: t.size > 0 };
  }, [responded, s.availability, s.slots, me]);
  const [ticks, setTicks] = useState<Set<string>>(initial.ticks);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [saveWeekly, setSaveWeekly] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(!responded || s.game.status === "open");
  const lowConf = new Set(parsed?.slots.filter((x) => x.confidence === "low").map((x) => x.slotId) ?? []);

  if (s.game.status === "confirmed" && !open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Change my availability
      </Button>
    );
  }

  const toggle = (id: string) => {
    const t = new Set(ticks);
    if (t.has(id)) t.delete(id);
    else t.add(id);
    setTicks(t);
  };

  const parse = async () => {
    setErr(null);
    setMsg(null);
    try {
      const r = await api<{ ok: boolean; result?: Parsed; message?: string }>("/api/v1/parse", { body: { gameId: s.game.id, text } });
      if (!r.ok || !r.result) {
        // Off-topic or unavailable: don't touch the ticks, undo any earlier AI fill
        if (parsed) {
          setParsed(null);
          setTicks(initial.ticks);
        }
        setErr(r.message ?? "Couldn't read that — please tick the slots.");
        return;
      }
      setParsed(r.result);
      setTicks(new Set(r.result.slots.filter((x) => x.available).map((x) => x.slotId)));
      setSaveWeekly(r.result.weekly.length > 0);
    } catch (e) {
      setErr((e as Error).message + " — please tick the slots instead.");
    }
  };

  const save = async () => {
    setErr(null);
    try {
      const weekly = parsed && saveWeekly && parsed.weekly.length ? parsed.weekly : undefined;
      await api(`/api/v1/games/${s.game.id}/availability`, { body: { available: [...ticks], weekly } });
      if (weekly) store.updateMe({ weekly });
      setParsed(null);
      setText("");
      setMsg("Saved ✓");
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Card title="When can you play?">
      {initial.fromWeekly && !parsed && <p className="mb-2 text-sm text-slate-500">Pre-ticked from your usual week — change anything that&apos;s different.</p>}
      <div className="space-y-2">
        {s.slots.map((sl) => {
          const on = ticks.has(sl.id);
          const low = lowConf.has(sl.id);
          const isConfirmed = s.game.confirmedSlotId === sl.id;
          return (
            <button
              key={sl.id}
              onClick={() => toggle(sl.id)}
              className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left ring-1 transition ${
                on ? "bg-emerald-50 ring-emerald-400" : "bg-white ring-slate-200"
              } ${low ? "outline-2 outline-dashed outline-amber-400" : ""}`}
            >
              <span>
                <span className="font-medium">{formatSlot(sl.startsAt)}</span>
                {isConfirmed && <span className="ml-2 rounded bg-emerald-600 px-1.5 py-0.5 text-xs text-white">confirmed</span>}
                {low && <span className="ml-2 text-xs text-amber-700">check this</span>}
                <span className="block text-xs text-slate-500">{sl.count} available</span>
              </span>
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-lg ${on ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-400"}`}>
                {on ? "✓" : ""}
              </span>
            </button>
          );
        })}
      </div>

      {parsed && (
        <div className="mt-3 space-y-2 rounded-xl bg-sky-50 p-3 text-sm ring-1 ring-sky-200">
          <p>🤖 {parsed.notes}</p>
          {lowConf.size > 0 && <p className="text-amber-800">Slots with a dashed outline were a guess — please check them.</p>}
          {parsed.weekly.length > 0 && (
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={saveWeekly} onChange={(e) => setSaveWeekly(e.target.checked)} />
              <span>
                Remember as my usual week: <WeeklySummary weekly={parsed.weekly} />
              </span>
            </label>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <Button onClick={save} className="flex-1">
          {parsed ? "Looks right — save" : "Save"}
        </Button>
        {parsed && (
          <Button variant="secondary" onClick={() => { setParsed(null); setTicks(initial.ticks); }}>
            Undo
          </Button>
        )}
      </div>
      {msg && <p className="mt-2 text-sm text-emerald-700">{msg}</p>}

      <div className="mt-5 border-t border-slate-200 pt-4">
        <label className="mb-1 block text-sm font-medium">Or just tell us when you&apos;re free</label>
        <textarea
          className={`${inputCls} min-h-20 py-2`}
          placeholder="e.g. weekday evenings, all day Saturday, not Sunday"
          value={text}
          maxLength={MAX_TEXT}
          onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT))}
        />
        <p className={`text-right text-xs ${text.length >= MAX_TEXT ? "text-rose-600" : "text-slate-400"}`}>
          {text.length}/{MAX_TEXT}
        </p>
        <Button variant="secondary" className="mt-1 w-full" disabled={!text.trim()} onClick={parse}>
          Fill in my ticks
        </Button>
      </div>
      <div className="mt-2">
        <ErrorNote error={err} />
      </div>
    </Card>
  );
}

export function WeeklySummary({ weekly }: { weekly: WeeklyWindow[] }) {
  return <span className="font-medium">{weekly.map((w) => `${DAY_LABEL[w.day as Day]} ${w.start}–${w.end}`).join(", ")}</span>;
}

function Payment({ s, me }: { s: GameState; me: Me }) {
  const row = s.money?.payers.find((p) => p.playerId === me.id);
  if (!s.money || !row) return null;
  const monzo = s.game.monzoUsername;
  return (
    <Card title="💷 Pay">
      {row.total <= 0 ? (
        <p className="text-emerald-700">All paid up — thanks! {row.total < 0 ? `(You're ${gbp(-row.total)} in credit.)` : ""}</p>
      ) : (
        <div className="space-y-2">
          <p>
            You owe <strong>{gbp(row.total)}</strong>
          </p>
          <ul className="text-sm text-slate-600">
            <li>This game: {gbp(row.outstanding)}{row.guests.length ? ` (incl. ${row.guests.join(", ")})` : ""}{row.lateDropout ? " — late dropout, spot not filled" : ""}</li>
            {row.carried !== 0 && <li>{row.carried > 0 ? "Carried over from earlier games" : "Credit from earlier games"}: {gbp(Math.abs(row.carried))}</li>}
          </ul>
          {monzo ? (
            <a
              href={monzoLink(monzo, row.total, s.game.title)}
              className="flex min-h-12 items-center justify-center rounded-xl bg-[#ff4f40] font-semibold text-white"
              target="_blank"
              rel="noreferrer"
            >
              Pay {gbp(row.total)} with Monzo
            </a>
          ) : (
            <p className="text-sm text-slate-500">The organiser hasn&apos;t added a Monzo link yet.</p>
          )}
        </div>
      )}
    </Card>
  );
}

function Guests({ s, me, reload }: { s: GameState; me: Me; reload: () => Promise<void> }) {
  const mine = s.people.filter((p) => p.isGuest && p.hostId === me.id && !p.droppedAt);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card title="Bringing a mate?">
      {mine.length > 0 && (
        <ul className="mb-3 space-y-1">
          {mine.map((g) => (
            <li key={g.id} className="flex items-center justify-between">
              <span>{g.name}</span>
              <Button
                variant="ghost"
                onClick={async () => {
                  await api(`/api/v1/games/${s.game.id}/drop`, { body: { signupId: g.id } });
                  await reload();
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            await api(`/api/v1/games/${s.game.id}/guests`, { body: { name } });
            setName("");
            await reload();
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        <input className={inputCls} placeholder={`${me.name}'s mate…`} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={!name.trim()}>
          Add
        </Button>
      </form>
      <p className="mt-2 text-xs text-slate-500">Guests count towards the {s.game.cap} and you cover their share. They play when you&apos;re available.</p>
      <ErrorNote error={err} />
    </Card>
  );
}

function Kit({ s, me, reload }: { s: GameState; me: Me; reload: () => Promise<void> }) {
  const mine = s.people.find((p) => p.playerId === me.id);
  const duties: [string, string][] = [
    ["ball", "⚽ Ball"],
    ["bibs", "🟧 Bibs"],
  ];
  return (
    <Card title="Kit">
      <div className="space-y-2">
        {duties.map(([duty, label]) => {
          const who = s.game.kit?.[duty];
          const person = who ? s.people.find((p) => p.id === who) : null;
          const isMe = mine && who === mine.id;
          return (
            <div key={duty} className="flex items-center justify-between">
              <span>
                {label}: <strong>{person ? person.name : "nobody yet"}</strong>
              </span>
              {mine && (!who || isMe) && (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await api(`/api/v1/games/${s.game.id}/kit`, { body: { duty, signupId: isMe ? null : mine.id } });
                    await reload();
                  }}
                >
                  {isMe ? "Actually, no" : "I'll bring it"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function Lineup({ s }: { s: GameState }) {
  const byId = new Map(s.people.map((p) => [p.id, p]));
  const confirmed = s.game.status === "confirmed";
  const label = (id: string) => {
    const p = byId.get(id)!;
    return p.isGuest ? (
      <>
        {p.name} <span className="text-slate-400">({p.hostName}&apos;s mate)</span>
      </>
    ) : (
      p.name
    );
  };
  if (!s.lineup.in.length && !s.lineup.waitlist.length) return null;
  return (
    <Card title={confirmed ? `Playing (${s.lineup.in.length}/${s.game.cap})` : `So far for the most popular slot (${s.lineup.in.length}/${s.game.cap})`}>
      <ol className="list-decimal space-y-0.5 pl-6">
        {s.lineup.in.map((id) => (
          <li key={id}>{label(id)}</li>
        ))}
      </ol>
      {s.lineup.waitlist.length > 0 && (
        <>
          <h3 className="mt-3 font-semibold text-amber-700">Waitlist</h3>
          <ol className="list-decimal space-y-0.5 pl-6 text-slate-700">
            {s.lineup.waitlist.map((id) => (
              <li key={id}>{label(id)}</li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}
