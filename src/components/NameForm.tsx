"use client";
import { useState } from "react";
import { identify, type Me } from "@/lib/client";
import { Button, ErrorNote, inputCls } from "./ui";

export function NameForm({ onDone }: { onDone: (me: Me) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        try {
          onDone(await identify(name, phone || undefined));
        } catch (e) {
          setErr((e as Error).message);
        }
      }}
    >
      <input className={inputCls} placeholder="Your name (as the group knows you)" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" required />
      <input className={inputCls} placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" />
      <Button type="submit" className="w-full" disabled={!name.trim()}>
        Continue
      </Button>
      <p className="text-xs text-slate-500">No password — we remember you on this phone.</p>
      <ErrorNote error={err} />
    </form>
  );
}
