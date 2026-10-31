"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { gbp } from "@/lib/logic";
import { Card } from "./ui";

type B = { playerId: string; name: string; owed: number; games: { gameId: string; title: string; charged: number; paid: number }[] };

export function Balances() {
  const [rows, setRows] = useState<B[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ balances: B[] }>("/api/v1/balances").then((r) => setRows(r.balances)).catch((e) => setErr(e.message));
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">💷 Running balances</h1>
      <p className="text-sm text-slate-600">Across all confirmed games. Positive = still owes.</p>
      {err && <p className="text-rose-700">{err}</p>}
      {!rows ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <Card>
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.playerId} className="py-2">
                <details>
                  <summary className="flex cursor-pointer items-center justify-between">
                    <span>{r.name}</span>
                    <span className={`font-semibold ${r.owed > 0 ? "text-rose-700" : "text-emerald-700"}`}>{gbp(r.owed)}</span>
                  </summary>
                  <ul className="mt-1 space-y-0.5 pl-3 text-sm text-slate-600">
                    {r.games.map((g) => (
                      <li key={g.gameId}>
                        <Link href={`/g/${g.gameId}`} className="underline">{g.title}</Link>: {gbp(g.charged)} charged, {gbp(g.paid)} paid
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
            {rows.length === 0 && <li className="py-2 text-slate-500">Nothing owed yet.</li>}
          </ul>
        </Card>
      )}
      <p className="text-center text-sm"><Link href="/" className="text-slate-500 underline">Home</Link></p>
    </div>
  );
}
