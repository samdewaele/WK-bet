import { describe, it, expect } from "vitest";
import { mapStatus, regulationScore, winnerSide } from "@/lib/football-data";

describe("regulationScore (strips the penalty shootout out of fullTime)", () => {
  it("subtracts the shootout from a penalty-decided KO match", () => {
    // Netherlands 1-1 Morocco, Morocco win 3-2 on pens → football-data fullTime 3-4.
    const score = {
      winner: "AWAY_TEAM" as const,
      duration: "PENALTY_SHOOTOUT",
      fullTime: { home: 3, away: 4 },
      penalties: { home: 2, away: 3 },
    };
    expect(regulationScore(score)).toEqual({ home: 1, away: 1 });
    expect(winnerSide(score)).toBe("away"); // Morocco won the shootout
  });

  it("leaves a decisive result untouched (no shootout)", () => {
    const score = { winner: "HOME_TEAM" as const, fullTime: { home: 2, away: 1 }, penalties: null };
    expect(regulationScore(score)).toEqual({ home: 2, away: 1 });
  });

  it("handles a group match with no penalties field", () => {
    const score = { winner: "DRAW" as const, fullTime: { home: 0, away: 0 } };
    expect(regulationScore(score)).toEqual({ home: 0, away: 0 });
  });

  it("ignores an empty penalties object (shootout not recorded)", () => {
    const score = { winner: null, fullTime: { home: 1, away: 1 }, penalties: { home: null, away: null } };
    expect(regulationScore(score)).toEqual({ home: 1, away: 1 });
  });
});

describe("mapStatus", () => {
  it.each([
    ["IN_PLAY",  "live"],
    ["PAUSED",   "live"],
    ["HALFTIME", "live"],
  ] as const)("maps %s → live", (input, expected) => {
    expect(mapStatus(input)).toBe(expected);
  });

  it("maps FINISHED → finished", () => {
    expect(mapStatus("FINISHED")).toBe("finished");
  });

  it.each([
    ["SCHEDULED"],
    ["TIMED"],
    ["POSTPONED"],
    ["CANCELLED"],
    ["SUSPENDED"],
  ] as const)("maps %s → scheduled", (input) => {
    expect(mapStatus(input)).toBe("scheduled");
  });

  it("live statuses are distinct from finished", () => {
    expect(mapStatus("IN_PLAY")).not.toBe("finished");
    expect(mapStatus("PAUSED")).not.toBe("finished");
  });

  it("finished is distinct from live", () => {
    expect(mapStatus("FINISHED")).not.toBe("live");
  });
});
