"use client";
// Game setup: choose candidate kick-off times either by tapping days + times
// (no AI) or by describing when the pitch is free (AI). Both produce a list that
// is ranked by how many regulars are usually free; the best 3 are pre-selected.
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { MAX_TEXT } from "@/lib/limits";
import { combineDaysTimes, nextDays, pickBest } from "@/lib/logic";
import { formatSlot, londonToUtc, type Day } from "@/lib/time";
import { Button, ErrorNote, inputCls } from "./ui";

type Cand = { local: string; startsAt: string };
type Mode = "pick" | "describe";
export const MAX_SELECTED = 6;
const PREFS_KEY = "kick.pitch";
const uniq = (xs: string[]) => [...new Set(xs)];

type Prefs = { mode: Mode; weekdays: Day[]; times: string[]; text: string };
function loadPrefs(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {}
}

export function KickoffPicker({ selected, onChange }: { selected: string[]; onChange: (s: string[]) => void }) {
  const [now] = useState(() => new Date());
  const days = useMemo(() => nextDays(now, 7), [now]);
  const [mode, setMode] = useState<Mode>("pick");
  const [pickDates, setPickDates] = useState<string[]>(() => days.map((d) => d.date));
  const [times, setTimes] = useState<string[]>(["19:00"]);
  const [text, setText] = useState("");
  const [ai, setAi] = useState<{ times: Cand[]; notes: string } | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [extras, setExtras] = useState<string[]>([]);
  const [extraInput, setExtraInput] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [regulars, setRegulars] = useState<number | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Remember how this organiser usually describes their pitch
  useEffect(() => {
    const p = loadPrefs();
    if (p.mode) setMode(p.mode);
    if (p.weekdays?.length) setPickDates(days.filter((d) => p.weekdays!.includes(d.day)).map((d) => d.date));
    if (p.times?.length) setTimes(p.times);
    if (p.text) setText(p.text);
    setPrefsLoaded(true);
  }, [days]);
  useEffect(() => {
    if (!prefsLoaded) return;
    savePrefs({ mode, weekdays: days.filter((d) => pickDates.includes(d.date)).map((d) => d.day), times, text });
  }, [prefsLoaded, mode, pickDates, times, text, days]);

  const cands: Cand[] = useMemo(
    () => (mode === "pick" ? combineDaysTimes(pickDates, times, now) : (ai?.times ?? [])),
    [mode, pickDates, times, now, ai],
  );
  const candKey = cands.map((c) => c.local).join(",");

  // Rank the generated times and pre-select the best 3 whenever the list changes
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      if (!cands.length) {
        onChange(extras);
        return;
      }
      try {
        const r = await api<{ regulars: number; scores: { startsAt: string; available: number }[] }>("/api/v1/rank-times", {
          body: { times: cands.map((c) => c.startsAt) },
        });
        if (cancelled) return;
        const byStart = new Map(r.scores.map((s) => [s.startsAt, s.available]));
        const ranked = cands.map((c) => ({ ...c, available: byStart.get(c.startsAt) ?? 0 }));
        setScores(Object.fromEntries(ranked.map((c) => [c.local, c.available])));
        setRegulars(r.regulars);
        onChange(uniq([...pickBest(ranked, 3), ...extras]).slice(0, MAX_SELECTED));
      } catch {
        if (!cancelled) onChange(uniq([...cands.slice(0, 3).map((c) => c.local), ...extras]).slice(0, MAX_SELECTED));
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // Re-run only when the generated list itself changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candKey]);

  const toggle = (local: string) => {
    if (selected.includes(local)) onChange(selected.filter((s) => s !== local));
    else if (selected.length < MAX_SELECTED) onChange([...selected, local]);
  };

  const findTimes = async () => {
    setAiErr(null);
    try {
      const r = await api<{ ok: boolean; times?: Cand[]; notes?: string; message?: string }>("/api/v1/pitch-times", { body: { text } });
      if (!r.ok || !r.times) {
        setAi(null);
        setAiErr(r.message ?? "Couldn't read that — use “Tap to pick” instead.");
        return;
      }
      setAi({ times: r.times, notes: r.notes ?? "" });
    } catch (e) {
      setAiErr((e as Error).message);
    }
  };

  const list = [...cands, ...extras.filter((x) => !cands.some((c) => c.local === x)).map((local) => ({ local, startsAt: londonToUtc(local).toISOString() }))].sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt),
  );
  const setDates = (pred: (d: (typeof days)[number]) => boolean) => setPickDates(days.filter(pred).map((d) => d.date));

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">When can the pitch be booked?</p>

      <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-medium" role="tablist">
        {(["pick", "describe"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`min-h-10 rounded-lg ${mode === m ? "bg-white shadow-sm" : "text-slate-500"}`}
          >
            {m === "pick" ? "Tap to pick" : "Describe it"}
          </button>
        ))}
      </div>

      {mode === "pick" ? (
        <div className="space-y-3">
          <div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((d) => {
                const on = pickDates.includes(d.date);
                return (
                  <button
                    key={d.date}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPickDates(on ? pickDates.filter((x) => x !== d.date) : [...pickDates, d.date])}
                    className={`flex flex-col items-center rounded-lg py-1.5 text-xs ring-1 ${on ? "bg-emerald-600 text-white ring-emerald-600" : "bg-white text-slate-700 ring-slate-200"}`}
                  >
                    <span className="font-semibold">{d.label.split(" ")[0]}</span>
                    <span>{d.label.split(" ")[1]}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
              <Button variant="ghost" onClick={() => setDates(() => true)}>Every day</Button>
              <Button variant="ghost" onClick={() => setDates((d) => !["sat", "sun"].includes(d.day))}>Weekdays</Button>
              <Button variant="ghost" onClick={() => setDates((d) => ["sat", "sun"].includes(d.day))}>Weekend</Button>
              <Button variant="ghost" onClick={() => setPickDates([])}>Clear</Button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs text-slate-500">Kick-off time{times.length > 1 ? "s" : ""}</p>
            {times.map((t, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="time"
                  step={900}
                  className={inputCls}
                  value={t}
                  onChange={(e) => setTimes(times.map((x, j) => (j === i ? e.target.value : x)))}
                />
                {times.length > 1 && (
                  <Button variant="secondary" onClick={() => setTimes(times.filter((_, j) => j !== i))}>
                    ✕
                  </Button>
                )}
              </div>
            ))}
            {times.length < 4 && (
              <Button variant="ghost" onClick={() => setTimes([...times, "20:00"])}>
                + another time
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            className={`${inputCls} min-h-20 py-2`}
            placeholder="e.g. P Rec pitch is free at 7pm every day except Sunday"
            value={text}
            maxLength={MAX_TEXT}
            onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT))}
          />
          <p className={`text-right text-xs ${text.length >= MAX_TEXT ? "text-rose-600" : "text-slate-400"}`}>
            {text.length}/{MAX_TEXT}
          </p>
          <Button variant="secondary" className="w-full" disabled={!text.trim()} onClick={findTimes}>
            Find times
          </Button>
          {ai?.notes && <p className="rounded-lg bg-sky-50 p-2 text-sm ring-1 ring-sky-200">🤖 {ai.notes}</p>}
          <ErrorNote error={aiErr} />
        </div>
      )}

      {list.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-slate-500">
            {regulars
              ? `We've ticked the times most regulars are usually free. Tap to change (up to ${MAX_SELECTED}).`
              : `Tap the times to offer (up to ${MAX_SELECTED}).`}
          </p>
          <ul className="divide-y divide-slate-200 rounded-xl ring-1 ring-slate-200">
            {list.map((c) => {
              const on = selected.includes(c.local);
              const isExtra = extras.includes(c.local);
              return (
                <li key={c.local} className="flex items-center gap-3 px-3 py-2">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(c.local)}
                    disabled={!on && selected.length >= MAX_SELECTED}
                    className="flex flex-1 items-center gap-3 text-left disabled:opacity-40"
                  >
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sm ${on ? "bg-emerald-600 text-white" : "ring-1 ring-slate-300"}`}>
                      {on ? "✓" : ""}
                    </span>
                    <span className="flex-1">{formatSlot(c.startsAt)}</span>
                    {regulars ? <span className="text-xs text-slate-500">{scores[c.local] ?? 0} usually free</span> : null}
                  </button>
                  {isExtra && (
                    <button
                      type="button"
                      aria-label="Remove"
                      className="text-slate-400"
                      onClick={() => {
                        setExtras(extras.filter((x) => x !== c.local));
                        onChange(selected.filter((s) => s !== c.local));
                      }}
                    >
                      ✕
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {mode === "pick" && list.length === 0 && <p className="text-sm text-slate-500">Pick at least one day and a time.</p>}

      <details className="text-sm">
        <summary className="cursor-pointer text-emerald-700">+ Add a specific date &amp; time</summary>
        <div className="mt-2 flex gap-2">
          <input type="datetime-local" step={900} className={inputCls} value={extraInput} onChange={(e) => setExtraInput(e.target.value)} />
          <Button
            variant="secondary"
            disabled={!extraInput || selected.length >= MAX_SELECTED}
            onClick={() => {
              setExtras(uniq([...extras, extraInput]));
              onChange(uniq([...selected, extraInput]));
              setExtraInput("");
            }}
          >
            Add
          </Button>
        </div>
      </details>
    </div>
  );
}
