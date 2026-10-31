import { describe, expect, it } from "vitest";
import { combineDaysTimes, nextDays, pickBest } from "@/lib/logic";
import { buildPitchPrompt, normalisePitch } from "@/lib/pitch-core";
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
  it("gives the model an explicit calendar and default range", () => {
    const { user } = buildPitchPrompt("7pm every day", NOW);
    expect(user).toContain("- 2026-10-31 Saturday 31 October (today)");
    expect(user).toContain("- 2026-11-13 Friday 13 November");
    expect(user).toContain("Default range: 2026-10-31 to 2026-11-06.");
  });

  it("drops off-calendar dates, past times and duplicates", () => {
    const r = normalisePitch(
      {
        onTopic: true,
        kickoffs: [
          { date: "2026-11-02", time: "19:00" },
          { date: "2026-11-02", time: "19:00" },
          { date: "2026-10-31", time: "09:00" }, // already passed
          { date: "2027-01-01", time: "19:00" }, // beyond the calendar
          { date: "2026-10-31", time: "19:00" },
        ],
        notes: "ok",
      },
      NOW,
    );
    expect(r.times.map((t) => t.local)).toEqual(["2026-10-31T19:00", "2026-11-02T19:00"]);
  });

  it("off-topic returns nothing", () => {
    const r = normalisePitch({ onTopic: false, kickoffs: [{ date: "2026-11-02", time: "19:00" }], notes: "a poem" }, NOW);
    expect(r).toEqual({ onTopic: false, times: [], notes: "" });
  });
});

const live = describe.skipIf(!process.env.ANTHROPIC_API_KEY);
const run = (text: string) => parsePitchTimes({ text, now: NOW });

live("pitch description (live Claude API)", () => {
  it('"p rec pitch is available at 7pm everyday" -> 19:00 on each of the next 7 days', async () => {
    const r = await run("p rec pitch is available at 7pm everyday");
    expect(r.onTopic).toBe(true);
    expect(r.times.map((t) => t.local)).toEqual(nextDays(NOW).map((d) => `${d.date}T19:00`));
  });

  it('"sunday 9-12" -> hourly kick-offs that fit in the window', async () => {
    const r = await run("sunday 9-12");
    expect(r.times.map((t) => t.local)).toEqual(["2026-11-01T09:00", "2026-11-01T10:00", "2026-11-01T11:00"]);
  });

  it('"8pm weekdays except thursday" -> Mon, Tue, Wed, Fri at 20:00', async () => {
    const r = await run("8pm weekdays except thursday");
    expect(r.times.map((t) => t.local)).toEqual(["2026-11-02T20:00", "2026-11-03T20:00", "2026-11-04T20:00", "2026-11-06T20:00"]);
  });

  it('"next week tuesday and thursday at 7" -> next week\'s dates, bare 7 = 19:00', async () => {
    // Today is Sat 31 Oct, so this week is Mon 26 Oct - Sun 1 Nov and "next week" is 2-8 Nov
    const r = await run("next week tuesday and thursday at 7");
    expect(r.times.map((t) => t.local)).toEqual(["2026-11-03T19:00", "2026-11-05T19:00"]);
  });

  it('"the week after next, wednesday 8pm" -> stays inside the 14-day calendar', async () => {
    const r = await run("the week after next, wednesday 8pm");
    expect(r.times.map((t) => t.local)).toEqual(["2026-11-11T20:00"]);
  });

  it("off-topic is rejected", async () => {
    const r = await run("write me a poem about our pitch on saturday");
    expect(r.onTopic).toBe(false);
    expect(r.times).toEqual([]);
  });
});
