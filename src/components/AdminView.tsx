"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import type { GameState } from "@/lib/service";
import { gbp, monzoLink, pickTeams } from "@/lib/logic";
import { formatSlot } from "@/lib/time";
import { announcementText, lineupText, paymentReminderText } from "@/lib/whatsapp";
import { Button, Card, CopyButton, ErrorNote, inputCls } from "./ui";
import { GameHeader, useGame } from "./GameView";

export function AdminView({ id, adminKey }: { id: string; adminKey: string }) {
  const { state: s, error, reload } = useGame(id, adminKey);
  const [origin, setOrigin] = useState("");
  const [actionErr, setActionErr] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  if (error && !s) return <p className="p-4 text-rose-700">{error}</p>;
  if (!s) return <p className="p-4 text-slate-500">Loading…</p>;
  if (!s.isAdmin) return <p className="p-4 text-rose-700">This admin link isn&apos;t valid.</p>;
  const url = `${origin}/g/${id}`;
  const post = async (path: string, body: unknown) => {
    setActionErr(null);
    try {
      await api(`/api/v1/games/${id}/${path}`, { body, adminKey });
    } catch (e) {
      setActionErr((e as Error).message);
    }
    await reload();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-slate-900 px-3 py-2 text-sm text-white">
        🔑 Organiser view — keep this link to yourself. <Link href={`/g/${id}`} className="underline">Player view</Link>
      </div>
      <GameHeader s={s} />
      {actionErr && (
        <div className="sticky top-2 z-10">
          <ErrorNote error={actionErr} />
        </div>
      )}

      <Card title="Share">
        <p className="mb-2 break-all rounded-lg bg-slate-50 p-2 text-sm">{url}</p>
        <div className="flex flex-wrap gap-2">
          <CopyButton variant="primary" text={announcementText(s, url)} label="Copy WhatsApp sign-up message" />
          <CopyButton text={url} label="Copy link" />
          {s.game.status === "confirmed" && <CopyButton text={lineupText(s, url)} label="Copy lineup message" />}
          {s.money && <CopyButton text={paymentReminderText(s, url)} label="Copy payment reminder" />}
        </div>
      </Card>

      <SlotPicker s={s} onConfirm={(slotId) => post("confirm", { slotId })} />
      {s.game.status === "confirmed" && <AdminLineup s={s} post={post} />}
      {s.money && <Payments s={s} post={post} />}
      {s.game.status === "confirmed" && <Teams s={s} />}
      <Settings s={s} adminKey={adminKey} reload={reload} />
    </div>
  );
}

function SlotPicker({ s, onConfirm }: { s: GameState; onConfirm: (slotId: string) => Promise<void> }) {
  const players = s.people.filter((p) => !p.isGuest);
  const guestsByHost = new Map<string, number>();
  s.people.filter((p) => p.isGuest && !p.droppedAt).forEach((g) => guestsByHost.set(g.hostId!, (guestsByHost.get(g.hostId!) ?? 0) + 1));
  return (
    <Card title={`Availability (${players.length} responded)`}>
      <div className="space-y-2">
        {s.slots.map((sl) => {
          const best = sl.id === s.bestSlotId;
          const isConfirmed = sl.id === s.game.confirmedSlotId;
          return (
            <div key={sl.id} className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 ring-1 ${best ? "bg-emerald-50 ring-emerald-400" : "ring-slate-200"}`}>
              <div>
                <p className="font-medium">
                  {formatSlot(sl.startsAt)} {best && <span className="text-xs text-emerald-700">★ most popular</span>}
                </p>
                <p className="text-sm text-slate-600">
                  {sl.count} available{sl.count > s.game.cap ? ` (${sl.count - s.game.cap} on waitlist)` : ""}
                </p>
              </div>
              {isConfirmed ? (
                <span className="rounded-lg bg-emerald-600 px-2 py-1 text-sm text-white">Confirmed</span>
              ) : (
                <Button
                  variant={best ? "primary" : "secondary"}
                  onClick={async () => {
                    if (s.game.status === "confirmed" && !confirm("Switch the confirmed time? The lineup will be rebuilt from availability.")) return;
                    await onConfirm(sl.id);
                  }}
                >
                  Confirm
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {players.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1 pr-2 font-normal">Player</th>
                {s.slots.map((sl) => (
                  <th key={sl.id} className="px-1 py-1 text-center font-normal whitespace-nowrap">
                    {formatSlot(sl.startsAt).replace(/ \w+,/, ",").split(", ").map((x, i) => (
                      <span key={i} className="block">{x}</span>
                    ))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="py-1 pr-2 whitespace-nowrap">
                    {p.name}
                    {guestsByHost.get(p.playerId!) ? <span className="text-slate-400"> +{guestsByHost.get(p.playerId!)}</span> : null}
                  </td>
                  {s.slots.map((sl) => (
                    <td key={sl.id} className="text-center">
                      {s.availability[p.playerId!]?.includes(sl.id) ? "✅" : "·"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AdminLineup({ s, post }: { s: GameState; post: (path: string, body: unknown) => Promise<void> }) {
  const byId = new Map(s.people.map((p) => [p.id, p]));
  const row = (id: string, i: number) => {
    const p = byId.get(id)!;
    return (
      <li key={id} className="flex items-center justify-between gap-2 py-1">
        <span>
          {i + 1}. {p.name} {p.isGuest && <span className="text-slate-400">({p.hostName}&apos;s mate)</span>}
        </span>
        <span className="flex items-center gap-2">
          <select
            aria-label="Skill"
            className="rounded-lg border border-slate-200 bg-white px-1 py-1 text-sm"
            value={p.skill ?? ""}
            onChange={(e) => post("skill", { signupId: p.id, skill: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">skill</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {"★".repeat(n)}
              </option>
            ))}
          </select>
          <Button variant="ghost" onClick={() => (confirm(`Drop ${p.name}?`) ? post("drop", { signupId: p.id }) : undefined)}>
            Drop
          </Button>
        </span>
      </li>
    );
  };
  const dropped = s.people.filter((p) => p.droppedAt);
  return (
    <Card title={`Lineup (${s.lineup.in.length}/${s.game.cap})`}>
      <ol>{s.lineup.in.map(row)}</ol>
      {s.lineup.waitlist.length > 0 && (
        <>
          <h3 className="mt-3 font-semibold text-amber-700">Waitlist</h3>
          <ol>{s.lineup.waitlist.map(row)}</ol>
        </>
      )}
      {dropped.length > 0 && <p className="mt-3 text-sm text-slate-500">Dropped: {dropped.map((p) => p.name).join(", ")}</p>}
      {s.events.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-slate-600">Activity</summary>
          <ul className="mt-1 space-y-0.5 text-slate-600">
            {s.events.map((e) => (
              <li key={e.id}>
                {e.message} <span className="text-slate-400">· {formatSlot(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function Payments({ s, post }: { s: GameState; post: (path: string, body: unknown) => Promise<void> }) {
  const m = s.money!;
  const owed = m.payers.reduce((t, p) => t + Math.max(0, p.total), 0);
  return (
    <Card title="💷 Who owes what" right={<span className="text-sm text-slate-500">{gbp(m.perHead)} × {m.heads}</span>}>
      {!s.game.monzoUsername && <p className="mb-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">Add your Monzo.me username in Settings below so players get a one-tap pay link.</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 font-normal">Who</th>
              <th className="py-1 text-right font-normal">This game</th>
              <th className="py-1 text-right font-normal">Earlier</th>
              <th className="py-1 text-right font-normal">Owes</th>
              <th className="py-1 text-center font-normal">Paid</th>
            </tr>
          </thead>
          <tbody>
            {m.payers.map((p) => (
              <tr key={p.playerId} className="border-t border-slate-100">
                <td className="py-2">
                  {p.name}
                  {p.guests.length > 0 && <span className="block text-xs text-slate-500">incl. {p.guests.join(", ")}</span>}
                  {p.lateDropout && <span className="block text-xs text-rose-600">late dropout</span>}
                </td>
                <td className="text-right">{gbp(p.thisGame)}</td>
                <td className="text-right">{p.carried ? gbp(p.carried) : "–"}</td>
                <td className={`text-right font-semibold ${p.total > 0 ? "text-rose-700" : "text-emerald-700"}`}>{gbp(p.total)}</td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-emerald-600"
                    checked={p.outstanding <= 0 && p.thisGame > 0}
                    onChange={(e) => post("paid", { playerId: p.playerId, paid: e.target.checked })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm text-slate-600">Outstanding: <strong>{gbp(owed)}</strong>. Ticking “paid” also clears earlier games owed to you.</p>
      {s.game.monzoUsername && (
        <p className="mt-1 text-xs text-slate-500">Pay links look like {monzoLink(s.game.monzoUsername, m.perHead)}</p>
      )}
    </Card>
  );
}

function Teams({ s }: { s: GameState }) {
  const [teams, setTeams] = useState<{ name: string; skill: number }[][] | null>(null);
  const players = s.lineup.in.map((id) => {
    const p = s.people.find((x) => x.id === id)!;
    return { name: p.name, skill: p.skill ?? 3 };
  });
  const text = teams
    ? `⚽ Teams\n\n🟧 Bibs: ${teams[0].map((p) => p.name).join(", ")}\n⬜ Non-bibs: ${teams[1].map((p) => p.name).join(", ")}`
    : "";
  return (
    <Card title="Teams">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setTeams(pickTeams(players, "balanced"))}>
          Balanced (by skill)
        </Button>
        <Button variant="secondary" onClick={() => setTeams(pickTeams(players, "random"))}>
          Random
        </Button>
        {teams && <CopyButton text={text} label="Copy teams" />}
      </div>
      {teams && (
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          {teams.map((t, i) => (
            <div key={i} className={`rounded-xl p-2 ${i ? "bg-slate-50" : "bg-orange-50"}`}>
              <p className="font-semibold">
                {i ? "⬜ Non-bibs" : "🟧 Bibs"} <span className="font-normal text-slate-500">({t.reduce((a, p) => a + p.skill, 0)})</span>
              </p>
              <ul>{t.map((p) => <li key={p.name}>{p.name}</li>)}</ul>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">Set skill ratings (1–5) in the lineup above; unrated players count as 3.</p>
    </Card>
  );
}

function Settings({ s, adminKey, reload }: { s: GameState; adminKey: string; reload: () => Promise<void> }) {
  const g = s.game;
  const [f, setF] = useState({
    title: g.title,
    location: g.location ?? "",
    mapsUrl: g.mapsUrl ?? "",
    cost: (g.costPence / 100).toFixed(2),
    cap: String(g.cap),
    monzoUsername: g.monzoUsername ?? "",
    dropoutHours: String(g.dropoutHours),
  });
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const patch = async (body: Record<string, unknown>) => {
    setErr(null);
    try {
      await api(`/api/v1/games/${g.id}`, { method: "PATCH", body, adminKey });
      setOk(true);
      setTimeout(() => setOk(false), 1500);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const field = (k: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block text-sm">
      <span className="text-slate-600">{label}</span>
      <input className={inputCls} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />
    </label>
  );
  return (
    <Card title="Settings">
      <div className="space-y-2">
        {field("monzoUsername", "Monzo.me username (monzo.me/…)", { placeholder: "e.g. moidsaber" })}
        {field("title", "Title")}
        {field("location", "Location")}
        {field("mapsUrl", "Google Maps link", { inputMode: "url" })}
        <div className="grid grid-cols-3 gap-2">
          {field("cost", "Pitch £", { inputMode: "decimal" })}
          {field("cap", "Player cap", { inputMode: "numeric" })}
          {field("dropoutHours", "Late-drop hrs", { inputMode: "numeric" })}
        </div>
        <p className="text-xs text-slate-500">If someone drops within {f.dropoutHours}h of kick-off and nobody takes their spot, they still owe their share.</p>
        <Button
          className="w-full"
          onClick={() =>
            patch({
              title: f.title,
              location: f.location,
              mapsUrl: f.mapsUrl,
              costPence: Math.round(parseFloat(f.cost || "0") * 100),
              cap: parseInt(f.cap || "14"),
              monzoUsername: f.monzoUsername,
              dropoutHours: parseInt(f.dropoutHours || "24"),
            })
          }
        >
          {ok ? "Saved ✓" : "Save settings"}
        </Button>
        <div className="flex gap-2 pt-2">
          {g.status === "confirmed" && (
            <Button variant="secondary" onClick={() => (confirm("Un-confirm the time and reopen voting?") ? patch({ status: "open" }) : undefined)}>
              Reopen voting
            </Button>
          )}
          {g.status !== "cancelled" ? (
            <Button variant="danger" onClick={() => (confirm("Cancel this game?") ? patch({ status: "cancelled" }) : undefined)}>
              Cancel game
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => patch({ status: "open" })}>
              Un-cancel
            </Button>
          )}
        </div>
        <ErrorNote error={err} />
      </div>
    </Card>
  );
}
