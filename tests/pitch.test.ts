import { describe, expect, it } from "vitest";
import { combineDaysTimes, nextDays, pickBest } from "@/lib/logic";
import { MAX_PITCH_TIMES, buildPitchPrompt, expandPitch, type PitchPattern } from "@/lib/pitch-core";
import { parsePitchTimes } from "@/lib/parse";

// Saturday 31 Oct 2026, 10:00 London (GMT)
const NOW = new Date("2026-10-31T10:00:00Z");

describe("tap-to-pick helpers", () => {
  it("lists the next 7 London days starting today", () => {
    const d = nextDays(NOW);
    expect(d.map((x) => x.date)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
    expect(d[0]).toMatchObject({ day: "sat", label: "Sat 31", isToday: true });
    expect(d[2]).toMatchObject({ day: "mon", label: "Mon 2" });
  });

  it("combines days × times, skipping times that have already passed", () => {
    const c = combineDaysTimes(["2026-10-31", "2026-11-01"], ["09:00", "19:00"], NOW);
    expect(c.map((x) => x.local)).toEqual(["2026-10-31T19:00", "2026-11-01T09:00", "2026-11-01T19:00"]);
  });

  it("works across the clocks going back (BST -> GMT)", () => {
    const before = new Date("2026-10-23T09:00:00Z"); // Fri, still BST
    const c = combineDaysTimes(["2026-10-24", "2026-10-26"], ["19:00"], before);
    expect(c.map((x) => x.startsAt)).toEqual(["2026-10-24T18:00:00.000Z", "2026-10-26T19:00:00.000Z"]);
  });

  it("pre-selects the times most regulars are free for", () => {
    const best = pickBest([
      { local: "a", available: 2 },
      { local: "b", available: 9 },
      { local: "c", available: 9 },
      { local: "d", available: 5 },
    ]);
    expect(best).toEqual(["b", "c", "d"]);
  });
});

describe("pitch description prompt", () => {
  it("gives the model a calendar covering all of next month and a 30-day default", () => {
    const { user } = buildPitchPrompt("7pm every day", NOW);
    expect(user).toContain("2026-10-31 sat (today)");
    expect(user).toContain("2026-11-30 mon"); // end of next month
    expect(user).toContain("Default range: 2026-10-31 to 2026-11-29.");
  });
});

const base: PitchPattern = { onTopic: true, from: "2026-10-31", to: "2026-11-29", weekly: [], dates: [], exclude: [], notes: "ok" };
const locals = (r: ReturnType<typeof expandPitch>) => r.times.map((t) => t.local);

describe("expanding the pattern into times", () => {
  it("every day at 19:00 for the default 30 days", () => {
    const r = expandPitch({ ...base, weekly: (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((day) => ({ day, times: ["19:00"] })) }, NOW);
    expect(r.times).toHaveLength(30);
    expect(r.times[0].local).toBe("2026-10-31T19:00");
    expect(r.times[29].local).toBe("2026-11-29T19:00");
  });

  it("respects exclusions, one-off dates, the range and times already passed", () => {
    const r = expandPitch(
      {
        ...base,
        from: "2026-11-01",
        to: "2026-11-15",
        weekly: [{ day: "thu", times: ["20:00"] }],
        dates: [{ date: "2026-10-31", times: ["09:00", "18:00"] }], // 09:00 today has passed
        exclude: ["2026-11-05"],
      },
      NOW,
    );
    expect(locals(r)).toEqual(["2026-10-31T18:00", "2026-11-12T20:00"]);
  });

  it("caps very long lists and says so", () => {
    const r = expandPitch({ ...base, to: "2026-12-30", weekly: (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((day) => ({ day, times: ["18:00", "19:00"] })) }, NOW);
    expect(r.times).toHaveLength(MAX_PITCH_TIMES);
    expect(r.truncated).toBe(true);
  });

  it("off-topic returns nothing", () => {
    expect(expandPitch({ ...base, onTopic: false, weekly: [{ day: "mon", times: ["19:00"] }] }, NOW)).toEqual({ onTopic: false, times: [], notes: "", truncated: false });
  });
});

const live = describe.skipIf(!process.env.ANTHROPIC_API_KEY);
const run = (text: string) => parsePitchTimes({ text, now: NOW });
const allAt = (r: ReturnType<typeof expandPitch>, time: string) => r.times.every((t) => t.local.endsWith(`T${time}`));
const weekdayOf = (local: string) => new Date(`${local.slice(0, 10)}T12:00:00Z`).getUTCDay(); // 0 = Sun

live("pitch description (live Claude API)", () => {
  it('"p rec pitch is available at 7pm everyday" -> 19:00 every day for the next 30 days', async () => {
    const r = await run("p rec pitch is available at 7pm everyday");
    expect(r.onTopic).toBe(true);
    expect(locals(r)).toEqual(nextDays(NOW, 30).map((d) => `${d.date}T19:00`));
  });

  it('"8pm weekdays except thursday" -> Mon/Tue/Wed/Fri at 20:00 across the month', async () => {
    const r = await run("8pm weekdays except thursday");
    expect(allAt(r, "20:00")).toBe(true);
    expect(r.times.map((t) => weekdayOf(t.local)).every((d) => [1, 2, 3, 5].includes(d))).toBe(true);
    expect(r.times.length).toBeGreaterThanOrEqual(16); // ~4 weeks × 4 days
  });

  it('"next month, tuesdays and thursdays at 7" -> every Tue/Thu in November at 19:00', async () => {
    const r = await run("next month, tuesdays and thursdays at 7");
    expect(locals(r)).toEqual(
      ["03", "05", "10", "12", "17", "19", "24", "26"].map((d) => `2026-11-${d}T19:00`),
    );
  });

  it('"sundays 9-12" -> hourly kick-offs every Sunday in range', async () => {
    const r = await run("sundays 9-12");
    expect(locals(r).slice(0, 6)).toEqual(["2026-11-01T09:00", "2026-11-01T10:00", "2026-11-01T11:00", "2026-11-08T09:00", "2026-11-08T10:00", "2026-11-08T11:00"]);
    expect(r.times.every((t) => weekdayOf(t.local) === 0)).toBe(true);
  });

  it('"just this sunday at 10am" -> a single one-off time', async () => {
    const r = await run("just this sunday at 10am");
    expect(locals(r)).toEqual(["2026-11-01T10:00"]);
  });

  it('"7pm every day except the 5th and the 12th" -> those dates are skipped', async () => {
    const r = await run("7pm every day except the 5th and the 12th");
    expect(allAt(r, "19:00")).toBe(true);
    expect(locals(r)).not.toContain("2026-11-05T19:00");
    expect(locals(r)).not.toContain("2026-11-12T19:00");
    expect(r.times).toHaveLength(28);
  });

  it("off-topic is rejected", async () => {
    const r = await run("write me a poem about our pitch on saturday");
    expect(r.onTopic).toBe(false);
    expect(r.times).toEqual([]);
  });
});
