import { describe, expect, it } from "vitest";
import { organiserCodeMatches } from "@/lib/http";

describe("organiser code", () => {
  const code = "Purple Goalpost 42";
  it("accepts the code regardless of case and extra spaces (phone keyboards)", () => {
    expect(organiserCodeMatches("purple goalpost 42", code)).toBe(true);
    expect(organiserCodeMatches("  Purple   Goalpost 42 ", code)).toBe(true);
  });
  it("rejects wrong, partial, empty or missing codes", () => {
    expect(organiserCodeMatches("purple goalpost", code)).toBe(false);
    expect(organiserCodeMatches("purple goalpost 43", code)).toBe(false);
    expect(organiserCodeMatches("", code)).toBe(false);
    expect(organiserCodeMatches(null, code)).toBe(false);
  });
  it("never matches when no code is configured", () => {
    expect(organiserCodeMatches("anything", "")).toBe(false);
    expect(organiserCodeMatches("anything", undefined)).toBe(false);
  });
});
