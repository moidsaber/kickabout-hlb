import { describe, expect, it } from "vitest";
import { buildParsePrompt, normaliseParsed, type ParsedAvailability } from "@/lib/parse-core";
import { parseAvailability } from "@/lib/parse";
import { londonToUtc } from "@/lib/time";

// Today = Saturday 31 Oct 2026. Candidate slots across the next week.
const NOW = new Date("2026-10-31T10:00:00Z");
const SLOTS = [
  { id: "sun-am", startsAt: londonToUtc("2026-11-01T10:00") }, // Sun (this weekend)
  { id: "tue-eve", startsAt: londonToUtc("2026-11-03T19:00") }, // Tue evening
  { id: "wed-eve", startsAt: londonToUtc("2026-11-04T19:30") }, // Wed evening
  { id: "thu-lunch", startsAt: londonToUtc("2026-11-05T12:30") }, // Thu lunchtime
  { id: "sat-am", startsAt: londonToUtc("2026-11-07T10:00") }, // next Sat morning
];

describe("parse prompt", () => {
  it("includes today's date, timezone, defaults and every slot id", () => {
    const { system, user } = buildParsePrompt("evenings", SLOTS, NOW);
    expect(user).toMatch(/Saturday,? 31 October 2026/);
    expect(user).toContain("Europe/London");
    for (const s of SLOTS) expect(user).toContain(`id: ${s.id}`);
    expect(user).toMatch(/Tuesday,? 3 November 2026, 19:00/);
    expect(system).toContain('"evening" / "evenings" / "tonight" = 18:00-22:00');
    expect(system).toContain('"after work" = after 18:00');
    expect(system).toContain('"all day" / "any time" / "free" with no time = 09:00-22:00');
  });

  it("normalises: fills missing slots as unavailable/low, drops unknown ids and bad windows", () => {
    const raw: ParsedAvailability = {
      slots: [{ slotId: "tue-eve", available: true, confidence: "high" }, { slotId: "bogus", available: true, confidence: "high" }],
      weekly: [{ day: "tue", start: "18:00", end: "22:00" }, { day: "wed", start: "22:00", end: "18:00" }],
      notes: "x",
    };
    const n = normaliseParsed(raw, SLOTS);
    expect(n.slots.map((s) => s.slotId)).toEqual(SLOTS.map((s) => s.id));
    expect(n.slots.find((s) => s.slotId === "sun-am")).toEqual({ slotId: "sun-am", available: false, confidence: "low" });
    expect(n.weekly).toHaveLength(1);
  });

  it("throws (so the route falls back to manual ticking) on refusal", async () => {
    const fake = { messages: { parse: async () => ({ stop_reason: "refusal", parsed_output: null }) } };
    await expect(parseAvailability({ text: "x", slots: SLOTS, now: NOW, anthropic: fake as never })).rejects.toThrow();
  });
});

// Live tests against the Claude API — run with ANTHROPIC_API_KEY set.
const live = describe.skipIf(!process.env.ANTHROPIC_API_KEY);
const run = (text: string) => parseAvailability({ text, slots: SLOTS, now: NOW });
const avail = (r: ParsedAvailability, id: string) => r.slots.find((s) => s.slotId === id)!.available;

live("parser (live Claude API)", () => {
  it('"evenings" -> evening slots yes, daytime no, recurring weekly evenings', async () => {
    const r = await run("evenings");
    expect(avail(r, "tue-eve")).toBe(true);
    expect(avail(r, "wed-eve")).toBe(true);
    expect(avail(r, "thu-lunch")).toBe(false);
    expect(avail(r, "sun-am")).toBe(false);
  });

  it('"this weekend" -> tomorrow (Sun) yes, next Saturday and weekdays no, nothing recurring', async () => {
    const r = await run("this weekend");
    expect(avail(r, "sun-am")).toBe(true);
    expect(avail(r, "tue-eve")).toBe(false);
    expect(avail(r, "sat-am")).toBe(false);
    expect(r.weekly).toEqual([]);
  });

  it('"not tuesday" -> tuesday is a confident no', async () => {
    const r = await run("not tuesday");
    const tue = r.slots.find((s) => s.slotId === "tue-eve")!;
    expect(tue.available).toBe(false);
    expect(tue.confidence).toBe("high");
  });

  it("the full example sentence -> slots and weekly pattern", async () => {
    const r = await run("im available after 6 monday-friday, available all day saturday and not free sunday");
    expect(avail(r, "tue-eve")).toBe(true);
    expect(avail(r, "wed-eve")).toBe(true);
    expect(avail(r, "thu-lunch")).toBe(false);
    expect(avail(r, "sat-am")).toBe(true);
    expect(avail(r, "sun-am")).toBe(false);
    const days = new Set(r.weekly.map((w) => w.day));
    for (const d of ["mon", "tue", "wed", "thu", "fri", "sat"]) expect(days.has(d as never)).toBe(true);
    expect(days.has("sun")).toBe(false);
    expect(r.weekly.find((w) => w.day === "mon")?.start).toBe("18:00");
    expect(r.weekly.find((w) => w.day === "sat")).toMatchObject({ start: "09:00", end: "22:00" });
  });
});
