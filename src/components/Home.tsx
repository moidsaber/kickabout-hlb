"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, store } from "@/lib/client";
import { londonToUtc, formatSlot, toLocalInput } from "@/lib/time";
import { Button, Card, CopyButton, ErrorNote, inputCls } from "./ui";

type Suggestion = { local: string; startsAt: string; label: string; available: number };
type Created = { id: string; adminKey: string; url: string; adminUrl: string };

export function Home() {
  const [games, setGames] = useState<{ id: string; title: string; adminKey?: string }[]>([]);
  const [created, setCreated] = useState<Created | null>(null);
  useEffect(() => setGames(store.games()), [created]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-3xl font-bold">⚽ Kickabout</h1>
        <p className="text-slate-600">Sort out 7-a-side without the 200-message WhatsApp thread.</p>
      </header>
      {created ? <CreatedCard c={created} onAnother={() => setCreated(null)} /> : <CreateGame onCreated={setCreated} />}
      {games.length > 0 && (
        <Card title="Your games">
          <ul className="divide-y">
            {games.map((g) => (
              <li key={g.id} className="flex items-center justify-between py-2">
                <Link href={`/g/${g.id}`} className="font-medium text-emerald-700">
                  {g.title}
                </Link>
                {g.adminKey && (
                  <Link href={`/g/${g.id}/admin?key=${g.adminKey}`} className="text-sm text-slate-500 underline">
                    organise
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-center text-sm">
        <Link href="/balances" className="text-slate-500 underline">
          Who owes what (all games)
        </Link>
      </p>
    </div>
  );
}

function CreatedCard({ c, onAnother }: { c: Created; onAnother: () => void }) {
  return (
    <Card title="✅ Game created">
      <div className="space-y-3 text-sm">
        <div>
          <p className="font-medium">Share with the group</p>
          <p className="break-all rounded-lg bg-slate-50 p-2">{c.url}</p>
        </div>
        <div>
          <p className="font-medium">Your secret organiser link (bookmark it!)</p>
          <p className="break-all rounded-lg bg-amber-50 p-2">{c.adminUrl}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/g/${c.id}/admin?key=${c.adminKey}`} className="flex min-h-11 items-center rounded-xl bg-emerald-600 px-4 font-medium text-white">
            Open organiser page →
          </Link>
          <CopyButton text={c.adminUrl} label="Copy organiser link" />
          <Button variant="ghost" onClick={onAnother}>
            Create another
          </Button>
        </div>
        <p className="text-slate-500">The organiser page has a ready-made WhatsApp message to paste.</p>
      </div>
    </Card>
  );
}

function defaultSlot() {
  // Next weekday at 19:00 London time
  const d = new Date(Date.now() + 86400_000);
  return `${toLocalInput(d).slice(0, 10)}T19:00`;
}

function CreateGame({ onCreated }: { onCreated: (c: Created) => void }) {
  const [title, setTitle] = useState("7-a-side");
  const [location, setLocation] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const [cost, setCost] = useState("");
  const [cap, setCap] = useState("14");
  const [monzo, setMonzo] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setMonzo(store.monzo() || store.me()?.monzoUsername || "");
    api<{ suggestions: Suggestion[] }>("/api/v1/suggestions")
      .then((r) => {
        setSuggestions(r.suggestions);
        setSlots(r.suggestions.length ? r.suggestions.map((s) => s.local) : [defaultSlot()]);
      })
      .catch(() => setSlots([defaultSlot()]));
  }, []);

  const setSlot = (i: number, v: string) => setSlots(slots.map((s, j) => (j === i ? v : s)));

  return (
    <Card title="Organise a game">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          const valid = slots.filter(Boolean);
          if (valid.length < 2 || valid.length > 6) return setErr("Add 2–6 candidate times.");
          try {
            store.setMonzo(monzo);
            const r = await api<Created>("/api/v1/games", {
              body: {
                title,
                location,
                mapsUrl,
                costPence: Math.round(parseFloat(cost || "0") * 100),
                cap: parseInt(cap || "14"),
                monzoUsername: monzo,
                slots: valid.map((s) => londonToUtc(s).toISOString()),
              },
            });
            store.rememberGame({ id: r.id, title, adminKey: r.adminKey });
            onCreated(r);
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        <label className="block text-sm">
          <span className="text-slate-600">Title</span>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Location</span>
          <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Powerleague Shoreditch" />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Google Maps link</span>
          <input className={inputCls} value={mapsUrl} onChange={(e) => setMapsUrl(e.target.value)} placeholder="https://maps.app.goo.gl/…" inputMode="url" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">
            <span className="text-slate-600">Pitch cost (£)</span>
            <input className={inputCls} value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="84" required />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Player cap</span>
            <input className={inputCls} value={cap} onChange={(e) => setCap(e.target.value)} inputMode="numeric" />
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-slate-600">Your Monzo.me username (optional, remembered)</span>
          <input className={inputCls} value={monzo} onChange={(e) => setMonzo(e.target.value)} placeholder="monzo.me/…" />
        </label>

        <div className="space-y-2">
          <p className="text-sm text-slate-600">Candidate kick-off times (2–6, UK time)</p>
          {suggestions.length > 0 && (
            <div className="rounded-xl bg-emerald-50 p-2 text-sm">
              <p className="mb-1 text-emerald-900">💡 Best times from everyone&apos;s usual week:</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => {
                  const added = slots.includes(s.local);
                  return (
                    <button
                      type="button"
                      key={s.local}
                      disabled={added || slots.length >= 6}
                      onClick={() => setSlots([...slots.filter(Boolean), s.local])}
                      className={`rounded-full px-3 py-1 ring-1 ${added ? "bg-emerald-600 text-white ring-emerald-600" : "bg-white ring-emerald-300"}`}
                    >
                      {formatSlot(s.startsAt)} · {s.available} free {added ? "✓" : "+"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {slots.map((s, i) => (
            <div key={i} className="flex gap-2">
              <input type="datetime-local" className={inputCls} value={s} step={900} onChange={(e) => setSlot(i, e.target.value)} />
              <Button variant="secondary" onClick={() => setSlots(slots.filter((_, j) => j !== i))}>
                ✕
              </Button>
            </div>
          ))}
          {slots.length < 6 && (
            <Button variant="ghost" onClick={() => setSlots([...slots, slots[slots.length - 1] ?? defaultSlot()])}>
              + Add a time
            </Button>
          )}
        </div>
        <Button type="submit" className="w-full">
          Create game &amp; get link
        </Button>
        <ErrorNote error={err} />
      </form>
    </Card>
  );
}
