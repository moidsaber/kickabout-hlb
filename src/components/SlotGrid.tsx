"use client";
// "Paint your hours" grid: days across, kick-off times down. Tap a cell to
// toggle it, or press and drag across cells to paint several at once
// (works with mouse and touch). Only real kick-off times get a cell.
import { useEffect, useMemo, useRef, useState } from "react";
import { DAY_LABEL, londonDate, londonHHMM, londonParts } from "@/lib/time";

type Slot = { id: string; startsAt: string | Date; count: number };
const PAGE = 7; // dates per page

const dayLabel = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  return {
    day: DAY_LABEL[londonParts(d).weekday],
    date: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(d),
  };
};

export function SlotGrid({
  slots,
  ticks,
  onChange,
  onPaintEnd,
  lowConf,
  confirmedId,
}: {
  slots: Slot[];
  ticks: Set<string>;
  onChange: (next: Set<string>) => void;
  onPaintEnd?: () => void;
  lowConf?: Set<string>;
  confirmedId?: string | null;
}) {
  const { dates, times, cell } = useMemo(() => {
    const key = (s: Slot) => {
      const d = new Date(s.startsAt);
      return [londonDate(d), londonHHMM(d)] as const;
    };
    const dates = [...new Set(slots.map((s) => key(s)[0]))].sort();
    const times = [...new Set(slots.map((s) => key(s)[1]))].sort();
    const cell = new Map(slots.map((s) => [key(s).join("|"), s]));
    return { dates, times, cell };
  }, [slots]);

  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(dates.length / PAGE));
  const shown = dates.slice(page * PAGE, page * PAGE + PAGE);

  // Painting state lives in a ref so pointer moves don't re-render needlessly
  const paint = useRef<{ on: boolean; touched: Set<string>; next: Set<string> } | null>(null);
  const apply = (id: string) => {
    const p = paint.current;
    if (!p || p.touched.has(id)) return;
    p.touched.add(id);
    if (p.on) p.next.add(id);
    else p.next.delete(id);
    onChange(new Set(p.next));
  };

  useEffect(() => {
    const end = () => {
      if (!paint.current) return;
      paint.current = null;
      onPaintEnd?.();
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [onPaintEnd]);

  const rangeLabel = shown.length ? `${dayLabel(shown[0]).date} – ${dayLabel(shown[shown.length - 1]).date}` : "";

  return (
    <div className="select-none">
      {pages > 1 && (
        <div className="mb-2 flex items-center justify-between text-sm">
          <button type="button" className="rounded-lg px-3 py-1 text-emerald-700 disabled:opacity-30" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ‹ Earlier
          </button>
          <span className="text-slate-500">{rangeLabel}</span>
          <button type="button" className="rounded-lg px-3 py-1 text-emerald-700 disabled:opacity-30" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            Later ›
          </button>
        </div>
      )}
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `3.25rem repeat(${shown.length}, minmax(0, 1fr))` }}
        onPointerMove={(e) => {
          if (!paint.current) return;
          const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-slot]");
          if (el?.dataset.slot) apply(el.dataset.slot);
        }}
      >
        <div />
        {shown.map((d) => {
          const l = dayLabel(d);
          return (
            <div key={d} className="pb-1 text-center leading-tight">
              <div className="text-sm font-semibold">{l.day}</div>
              <div className="text-xs text-slate-500">{l.date}</div>
            </div>
          );
        })}
        {times.map((t) => (
          <Row key={t} time={t}>
            {shown.map((d) => {
              const s = cell.get(`${d}|${t}`);
              if (!s) return <div key={d} />;
              const on = ticks.has(s.id);
              const low = lowConf?.has(s.id);
              const confirmed = confirmedId === s.id;
              return (
                <button
                  key={d}
                  type="button"
                  data-slot={s.id}
                  aria-pressed={on}
                  aria-label={`${dayLabel(d).day} ${dayLabel(d).date} ${t}${on ? ", free" : ""}`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    // Touch captures the pointer to this cell; release it so dragging reaches other cells
                    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
                    paint.current = { on: !ticks.has(s.id), touched: new Set(), next: new Set(ticks) };
                    apply(s.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    const next = new Set(ticks);
                    if (on) next.delete(s.id);
                    else next.add(s.id);
                    onChange(next);
                    onPaintEnd?.();
                  }}
                  className={`relative h-9 touch-none rounded-md text-[10px] font-medium transition-colors ${
                    on ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-500 ring-1 ring-slate-200"
                  } ${low ? "outline-2 outline-offset-1 outline-dashed outline-amber-400" : ""} ${confirmed ? "ring-2 ring-emerald-700" : ""}`}
                >
                  {confirmed ? "★ " : ""}
                  {s.count > 0 ? s.count : ""}
                </button>
              );
            })}
          </Row>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Numbers show how many can make each time{confirmedId ? " · ★ = confirmed time" : ""}.
      </p>
    </div>
  );
}

function Row({ time, children }: { time: string; children: React.ReactNode }) {
  return (
    <>
      <div className="flex items-center justify-end pr-2 text-xs text-slate-500">{time}</div>
      {children}
    </>
  );
}
