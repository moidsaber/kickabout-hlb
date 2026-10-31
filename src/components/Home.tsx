"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, api, store } from "@/lib/client";
import { londonToUtc } from "@/lib/time";
import { KickoffPicker } from "./KickoffPicker";
import { Button, Card, CopyButton, ErrorNote, inputCls } from "./ui";

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
      {created ? <CreatedCard c={created} onAnother={() => setCreated(null)} /> : <OrganiserGate onCreated={setCreated} />}
      {games.length > 0 && (
        <Card title="Your games">
          <ul className="divide-y divide-slate-200">
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

/** Only people with the organiser code see the create form. Players just use game links. */
function OrganiserGate({ onCreated }: { onCreated: (c: Created) => void }) {
  const [state, setState] = useState<"checking" | "locked" | "open">("checking");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const verify = async (c: string) => {
    await api("/api/v1/organiser", { body: { code: c } });
    store.setOrganiserCode(c);
    setState("open");
  };

  useEffect(() => {
    (async () => {
      try {
        const { required } = await api<{ required: boolean }>("/api/v1/organiser");
        const saved = store.organiserCode();
        if (!required) return setState("open");
        if (!saved) return setState("locked");
        await verify(saved); // the code may have been changed since
      } catch {
        store.forgetOrganiserCode();
        setState("locked");
      }
    })();
  }, []);

  if (state === "checking") return null;
  if (state === "open")
    return (
      <CreateGame
        onCreated={onCreated}
        onLocked={(msg) => {
          store.forgetOrganiserCode();
          setErr(msg);
          setState("locked");
        }}
      />
    );
  return (
    <Card title="Start a game">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            await verify(code.trim());
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        <p className="text-sm text-slate-600">Only organisers can start games. Enter the organiser code to unlock this on this phone.</p>
        <input className={inputCls} type="password" autoComplete="off" autoCapitalize="none" placeholder="Organiser code" value={code} onChange={(e) => setCode(e.target.value)} />
        <Button type="submit" className="w-full" disabled={!code.trim()}>
          Unlock
        </Button>
        <ErrorNote error={err} />
        <p className="text-xs text-slate-500">Just playing? You don&apos;t need a code — open the game link from the group chat.</p>
      </form>
    </Card>
  );
}

function CreateGame({ onCreated, onLocked }: { onCreated: (c: Created) => void; onLocked: (msg: string) => void }) {
  const [title, setTitle] = useState("7-a-side");
  const [location, setLocation] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const [cost, setCost] = useState("");
  const [cap, setCap] = useState("14");
  const [monzo, setMonzo] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMonzo(store.monzo() || store.me()?.monzoUsername || "");
  }, []);

  return (
    <Card
      title="Organise a game"
      right={
        store.organiserCode() ? (
          <button type="button" className="text-xs text-slate-500 underline" onClick={() => onLocked("")}>
            Lock this phone
          </button>
        ) : null
      }
    >
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          const valid = slots.filter(Boolean);
          if (valid.length < 1) return setErr("Tick at least one kick-off time.");
          setBusy(true);
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
            // Code changed or removed on the server: ask for it again
            if (e instanceof ApiError && (e.status === 403 || e.status === 503)) return onLocked(e.message);
            setErr((e as Error).message);
          } finally {
            setBusy(false);
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

        <KickoffPicker selected={slots} onChange={setSlots} />
        <Button type="submit" className="w-full" disabled={busy || slots.length === 0}>
          {busy ? "Creating…" : slots.length ? `Create game with ${slots.length} time${slots.length === 1 ? "" : "s"}` : "Tick at least one time"}
        </Button>
        <ErrorNote error={err} />
      </form>
    </Card>
  );
}
