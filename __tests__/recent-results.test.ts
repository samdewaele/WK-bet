import { describe, it, expect } from "vitest";
import { filterRecentResults, type RecentMatch } from "@/lib/recent-results";

const TEAM_A = { id: "ta", name: "Brazil", flag: "🇧🇷" };
const TEAM_B = { id: "tb", name: "Germany", flag: "🇩🇪" };

function match(overrides: Partial<RecentMatch> = {}): RecentMatch {
  return {
    id: overrides.id ?? "m1",
    round: overrides.round ?? "Group",
    group: overrides.group ?? "A",
    kickoff: overrides.kickoff ?? "2026-06-15T18:00:00Z",
    homeScore: overrides.homeScore ?? 2,
    awayScore: overrides.awayScore ?? 1,
    status: overrides.status ?? "finished",
    homeTeam: overrides.homeTeam !== undefined ? overrides.homeTeam : TEAM_A,
    awayTeam: overrides.awayTeam !== undefined ? overrides.awayTeam : TEAM_B,
  };
}

describe("filterRecentResults", () => {
  it("returns empty array when given empty input", () => {
    expect(filterRecentResults([])).toEqual([]);
  });

  it("returns empty array when no matches are finished", () => {
    expect(filterRecentResults([
      match({ status: "scheduled" }),
      match({ id: "m2", status: "live" }),
    ])).toEqual([]);
  });

  it("filters out non-finished matches, keeps only finished", () => {
    const result = filterRecentResults([
      match({ id: "fin", status: "finished" }),
      match({ id: "sched", status: "scheduled" }),
      match({ id: "live", status: "live" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("fin");
  });

  it("filters out matches where homeTeam is null", () => {
    const result = filterRecentResults([
      match({ id: "no-home", homeTeam: null }),
    ]);
    expect(result).toEqual([]);
  });

  it("filters out matches where awayTeam is null", () => {
    const result = filterRecentResults([
      match({ id: "no-away", awayTeam: null }),
    ]);
    expect(result).toEqual([]);
  });

  it("sorts by kickoff descending (most recent first)", () => {
    const result = filterRecentResults([
      match({ id: "old", kickoff: "2026-06-11T15:00:00Z" }),
      match({ id: "newest", kickoff: "2026-06-15T21:00:00Z" }),
      match({ id: "mid", kickoff: "2026-06-13T18:00:00Z" }),
    ]);
    expect(result.map((m) => m.id)).toEqual(["newest", "mid", "old"]);
  });

  it("returns at most 5 results when more are available", () => {
    const matches = Array.from({ length: 8 }, (_, i) =>
      match({ id: `m${i}`, kickoff: `2026-06-${10 + i}T18:00:00Z` })
    );
    expect(filterRecentResults(matches)).toHaveLength(5);
  });

  it("the 5 returned results are the 5 most recent", () => {
    const matches = Array.from({ length: 8 }, (_, i) =>
      match({ id: `m${i}`, kickoff: `2026-06-${10 + i}T18:00:00Z` })
    );
    const result = filterRecentResults(matches);
    // Most recent is m7 (June 17), then m6, m5, m4, m3
    expect(result.map((m) => m.id)).toEqual(["m7", "m6", "m5", "m4", "m3"]);
  });

  it("returns fewer than 5 when not enough finished matches exist", () => {
    const result = filterRecentResults([
      match({ id: "a" }),
      match({ id: "b" }),
    ]);
    expect(result).toHaveLength(2);
  });

  it("custom limit is respected", () => {
    const matches = Array.from({ length: 10 }, (_, i) =>
      match({ id: `m${i}`, kickoff: `2026-06-${10 + i}T18:00:00Z` })
    );
    expect(filterRecentResults(matches, 3)).toHaveLength(3);
  });

  it("includes KO round matches alongside group matches", () => {
    const result = filterRecentResults([
      match({ id: "ko", round: "QF", group: null, kickoff: "2026-07-05T18:00:00Z" }),
      match({ id: "grp", round: "Group", group: "A", kickoff: "2026-06-15T18:00:00Z" }),
    ]);
    expect(result.map((m) => m.id)).toEqual(["ko", "grp"]);
  });
});
