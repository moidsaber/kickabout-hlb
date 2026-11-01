"use client";
import { useState, type ReactNode } from "react";

export function Card({ title, children, right }: { title?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void | Promise<void>;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const styles = {
    primary: "bg-emerald-600 text-white active:bg-emerald-700",
    secondary: "bg-slate-100 text-slate-900 active:bg-slate-200",
    danger: "bg-rose-50 text-rose-700 active:bg-rose-100",
    ghost: "text-emerald-700 underline-offset-2 hover:underline px-1",
  }[variant];
  return (
    <button
      type={type}
      disabled={disabled || busy}
      onClick={
        onClick
          ? async () => {
              setBusy(true);
              try {
                await onClick();
              } finally {
                setBusy(false);
              }
            }
          : undefined
      }
      className={`${variant === "ghost" ? "" : "min-h-11 rounded-xl px-4 font-medium"} ${styles} disabled:opacity-50 ${className}`}
    >
      {busy ? "…" : children}
    </button>
  );
}

export function CopyButton({ text, label, variant = "secondary" }: { text: string; label: string; variant?: "primary" | "secondary" }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant={variant}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied ✓" : label}
    </Button>
  );
}

export const inputCls =
  "w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200";

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>;
}
