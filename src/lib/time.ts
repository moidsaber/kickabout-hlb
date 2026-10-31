// Europe/London helpers. Everything is stored as UTC timestamptz and
// converted at the edges using Intl (handles BST/GMT automatically).

export const TZ = "Europe/London";
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

export function londonParts(d: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    weekday: p.weekday.toLowerCase().slice(0, 3) as Day,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:MM" in London time */
export function londonHHMM(d: Date) {
  const p = londonParts(d);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "YYYY-MM-DD" in London time */
export function londonDate(d: Date) {
  const p = londonParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Value for <input type="datetime-local"> in London time */
export function toLocalInput(d: Date) {
  return `${londonDate(d)}T${londonHHMM(d)}`;
}

/** Interpret "YYYY-MM-DDTHH:MM" as London wall-clock time and return the UTC instant. */
export function londonToUtc(local: string): Date {
  const [date, time = "00:00"] = local.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const target = Date.UTC(y, m - 1, d, hh, mm);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = londonParts(new Date(guess));
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const diff = target - asUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

/** e.g. "Tue 4 Nov, 19:00" */
export function formatSlot(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d;
  const s = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return s.replace(/ at /, ", ");
}

/** e.g. "Saturday 31 October 2026" */
export function formatLongDate(d: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

export const DAY_LABEL: Record<Day, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};
