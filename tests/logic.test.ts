import { describe, expect, it } from "vitest";
import { computeCharges, computeLineup, pickTeams, roundUp10, suggestKickoffs, weeklyCovers, monzoLink, type SignupLite } from "@/lib/logic";
import { londonToUtc, londonHHMM } from "@/lib/time";

const t = (m: number) => new Date(Date.UTC(2026, 10, 1, 12, m)).toISOString();
const player = (i: number, extra: Partial<SignupLite> = {}): SignupLite => ({
  id: `s${i}`, playerId: `p${i}`, addedBy: null, createdAt: t(i), queuedAt: t(i), droppedAt: null, droppedWhileIn: false, ...extra,
});

describe("lineup", () => {
  it("first `cap` available are in, rest waitlisted in order (pre-confirmation)", () => {
    const signups = Array.from({ length: 16 }, (_, i) => player(i, { queuedAt: null }));
    const avail = new Set(signups.filter((_, i) => i !== 3).map((s) => `slot:${s.playerId}`));
    const l = computeLineup(signups, { cap: 14, confirmed: false, slotId: "slot", avail });
    expect(l.in).toHaveLength(14);
    expect(l.in.map((s) => s.id)).not.toContain("s3");
    expect(l.waitlist.map((s) => s.id)).toEqual(["s15"]);
  });

  it("dropping promotes the top of the waitlist (confirmed)", () => {
    const signups = Array.from({ length: 16 }, (_, i) => player(i));
    const before = computeLineup(signups, { cap: 14, confirmed: true, slotId: "x", avail: new Set() });
    expect(before.waitlist.map((s) => s.id)).toEqual(["s14", "s15"]);
    signups[2].droppedAt = t(100);
    const after = computeLineup(signups, { cap: 14, confirmed: true, slotId: "x", avail: new Set() });
    expect(after.in.map((s) => s.id)).toContain("s14");
    expect(after.waitlist.map((s) => s.id)).toEqual(["s15"]);
  });

  it("guests are available when their host is", () => {
    const host = player(1, { queuedAt: null });
    const guest: SignupLite = { ...player(2, { queuedAt: null }), playerId: null, addedBy: "p1" };
    const l = computeLineup([host, guest], { cap: 14, confirmed: false, slotId: "a", avail: new Set(["a:p1"]) });
    expect(l.in.map((s) => s.id)).toEqual(["s1", "s2"]);
  });
});

describe("payments", () => {
  const kickoff = new Date(Date.UTC(2026, 10, 5, 19));
  const game = { costPence: 8400, cap: 14, dropoutHours: 24, kickoff };

  it("rounds up to the nearest 10p", () => {
    expect(roundUp10(8400 / 13)).toBe(650); // 646.15 -> 650
    expect(roundUp10(600)).toBe(600);
  });

  it("splits cost across confirmed players incl. guests, guest share goes to host", () => {
    const signups = [...Array.from({ length: 12 }, (_, i) => player(i)), { ...player(12), playerId: null, addedBy: "p0" }];
    const { perHead, charges } = computeCharges(signups, signups.map((s) => s.id), game);
    expect(perHead).toBe(650);
    expect(charges.filter((c) => c.payerId === "p0").reduce((a, c) => a + c.pence, 0)).toBe(1300);
  });

  it("late dropout owes if not replaced, not if replaced", () => {
    const late = new Date(kickoff.getTime() - 3 * 3600_000).toISOString();
    const signups = Array.from({ length: 14 }, (_, i) => player(i));
    signups[0] = { ...signups[0], droppedAt: late, droppedWhileIn: true };
    const inIds = signups.slice(1).map((s) => s.id); // 13 in, no replacement
    const r1 = computeCharges(signups, inIds, game);
    expect(r1.heads).toBe(14);
    expect(r1.charges.find((c) => c.signupId === "s0")?.reason).toBe("late-dropout");

    const withSub = [...signups, player(99)];
    const replaced = computeCharges(withSub, [...inIds, "s99"], game); // waitlister took the spot
    expect(replaced.charges.find((c) => c.signupId === "s0")).toBeUndefined();
  });

  it("early dropout owes nothing", () => {
    const early = new Date(kickoff.getTime() - 48 * 3600_000).toISOString();
    const signups = [player(0, { droppedAt: early, droppedWhileIn: true }), player(1)];
    const r = computeCharges(signups, ["s1"], game);
    expect(r.charges.map((c) => c.signupId)).toEqual(["s1"]);
    expect(r.perHead).toBe(8400);
  });

  it("builds monzo.me links", () => {
    expect(monzoLink("@moid", 650)).toBe("https://monzo.me/moid/6.50");
  });
});

describe("weekly availability & suggestions", () => {
  it("matches London local time across GMT/BST", () => {
    const winter = londonToUtc("2026-11-03T19:00"); // Tue, GMT
    const summer = londonToUtc("2026-07-07T19:00"); // Tue, BST
    expect(winter.toISOString()).toBe("2026-11-03T19:00:00.000Z");
    expect(summer.toISOString()).toBe("2026-07-07T18:00:00.000Z");
    expect(londonHHMM(summer)).toBe("19:00");
    const w = [{ day: "tue" as const, start: "18:00", end: "22:00" }];
    expect(weeklyCovers(w, winter)).toBe(true);
    expect(weeklyCovers(w, summer)).toBe(true);
    expect(weeklyCovers(w, londonToUtc("2026-11-04T19:00"))).toBe(false);
  });

  it("suggests the 3 most popular kick-offs", () => {
    const ev = (day: "tue" | "thu" | "sat", start = "18:00", end = "22:00") => ({ day, start, end });
    const weeklies = [[ev("thu")], [ev("thu")], [ev("thu"), ev("tue")], [ev("tue")], [ev("sat", "09:00", "12:00")]];
    const s = suggestKickoffs(weeklies, new Date("2026-10-31T12:00:00Z"));
    expect(s).toHaveLength(3);
    expect(s[0].label).toBe("Thu 19:00");
    expect(s[0].available).toBe(3);
    expect(s[1].label).toBe("Tue 19:00");
    expect(s[2].label.startsWith("Sat")).toBe(true);
  });
});

describe("teams", () => {
  it("balanced teams have similar total skill", () => {
    const people = [5, 5, 4, 4, 3, 3, 3, 2, 2, 1, 1, 3, 4, 2].map((skill, i) => ({ name: `p${i}`, skill }));
    const [a, b] = pickTeams(people, "balanced");
    const sum = (x: typeof a) => x.reduce((s, p) => s + p.skill, 0);
    expect(a.length + b.length).toBe(14);
    expect(Math.abs(a.length - b.length)).toBeLessThanOrEqual(1);
    expect(Math.abs(sum(a) - sum(b))).toBeLessThanOrEqual(2);
  });
});
