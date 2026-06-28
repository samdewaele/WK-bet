import { describe, it, expect } from "vitest";
import {
  calculatePot,
  scoreGroupStanding,
  earnedFromGroupStanding,
  scoreKnockoutMatch,
  earnedFromKOMatch,
  scoreKnockoutMatchWithTeams,
  koWinnerSide,
  prizePerSideBet,
  KO_MATCH_WEIGHT,
  KO_ROUNDS,
} from "@/lib/pot";

describe("koWinnerSide (canonical KO winner)", () => {
  it("returns the higher-scoring side for a decisive result", () => {
    expect(koWinnerSide(2, 1)).toBe("home");
    expect(koWinnerSide(0, 3)).toBe("away");
  });
  it("uses the penalty winner for a level score", () => {
    expect(koWinnerSide(1, 1, "home")).toBe("home");
    expect(koWinnerSide(1, 1, "away")).toBe("away");
  });
  it("is undecided (null) for a level score with no penalty winner", () => {
    expect(koWinnerSide(1, 1)).toBeNull();
    expect(koWinnerSide(0, 0, null)).toBeNull();
    expect(koWinnerSide(2, 2, "draw")).toBeNull();
  });
});

// ─── KO weight sanity ───────────────────────────────────────────────────────

describe("KO_MATCH_WEIGHT — total units", () => {
  it("sums to exactly 5 across all matches", () => {
    const matchCounts: Record<string, number> = {
      R32: 16, R16: 8, QF: 4, SF: 2, "3rd": 1, Final: 1,
    };
    const total = KO_ROUNDS.reduce(
      (sum, r) => sum + matchCounts[r] * KO_MATCH_WEIGHT[r],
      0
    );
    expect(total).toBeCloseTo(5, 10);
  });

  it("per-match prize doubles each main round", () => {
    expect(KO_MATCH_WEIGHT.R16).toBeCloseTo(KO_MATCH_WEIGHT.R32 * 2, 10);
    expect(KO_MATCH_WEIGHT.QF).toBeCloseTo(KO_MATCH_WEIGHT.R16 * 2, 10);
    expect(KO_MATCH_WEIGHT.SF).toBeCloseTo(KO_MATCH_WEIGHT.QF * 2, 10);
  });

  it("Final is worth more than 3rd place", () => {
    expect(KO_MATCH_WEIGHT.Final).toBeGreaterThan(KO_MATCH_WEIGHT["3rd"]);
  });

  it("Final is exactly 2× 3rd place", () => {
    expect(KO_MATCH_WEIGHT.Final).toBeCloseTo(KO_MATCH_WEIGHT["3rd"] * 2, 10);
  });
});

// ─── calculatePot ───────────────────────────────────────────────────────────

describe("calculatePot", () => {
  it("splits 50/50 between group stage and knockout", () => {
    const pot = calculatePot(100, 10);
    expect(pot.totalPot).toBe(1000);
    expect(pot.groupStagePot).toBe(500);
    expect(pot.knockoutPot).toBe(500);
  });

  it("divides group stage equally across 12 WC groups", () => {
    const pot = calculatePot(120, 10);
    expect(pot.prizePerWCGroup).toBeCloseTo(1200 * 0.5 / 12, 10);
  });

  it("KO unit is knockoutPot / 5", () => {
    const pot = calculatePot(100, 10);
    expect(pot.koUnit).toBeCloseTo(500 / 5, 10);
  });

  it("prizePerKOMatch[Final] > prizePerKOMatch[R32]", () => {
    const pot = calculatePot(100, 10);
    expect(pot.prizePerKOMatch.Final).toBeGreaterThan(pot.prizePerKOMatch.R32);
  });

  it("all KO match prizes sum to knockoutPot", () => {
    const pot = calculatePot(100, 10);
    const matchCounts: Record<string, number> = {
      R32: 16, R16: 8, QF: 4, SF: 2, "3rd": 1, Final: 1,
    };
    const total = KO_ROUNDS.reduce(
      (sum, r) => sum + matchCounts[r] * pot.prizePerKOMatch[r],
      0
    );
    expect(total).toBeCloseTo(pot.knockoutPot, 8);
  });

  it("returns zero pot for zero entry fee", () => {
    const pot = calculatePot(0, 10);
    expect(pot.totalPot).toBe(0);
    expect(pot.prizePerWCGroup).toBe(0);
  });
});

// ─── scoreGroupStanding ─────────────────────────────────────────────────────

describe("scoreGroupStanding", () => {
  const teams = ["A", "B", "C", "D"] as [string, string, string, string];

  it("returns 1.0 for perfect prediction", () => {
    const r = scoreGroupStanding(teams, teams);
    expect(r.scoreMultiplier).toBe(1.0);
    expect(r.label).toMatch(/all 4/i);
  });

  it("returns 0.75 when top 2 are correct", () => {
    const predicted: [string, string, string, string] = ["A", "B", "D", "C"];
    const r = scoreGroupStanding(predicted, teams);
    expect(r.scoreMultiplier).toBe(0.75);
    expect(r.label).toMatch(/top 2/i);
  });

  it("returns 0.5 when only 1st place is correct", () => {
    const predicted: [string, string, string, string] = ["A", "C", "B", "D"];
    const r = scoreGroupStanding(predicted, teams);
    expect(r.scoreMultiplier).toBe(0.5);
    expect(r.label).toMatch(/1st/i);
  });

  it("returns 0 when 1st place is wrong", () => {
    const predicted: [string, string, string, string] = ["B", "A", "C", "D"];
    const r = scoreGroupStanding(predicted, teams);
    expect(r.scoreMultiplier).toBe(0);
  });

  it("returns 0 when completely wrong", () => {
    const predicted: [string, string, string, string] = ["D", "C", "B", "A"];
    const r = scoreGroupStanding(predicted, teams);
    expect(r.scoreMultiplier).toBe(0);
  });

  it("0.75 requires BOTH top-2 correct, not just one", () => {
    // 1st correct, 2nd wrong → should be 0.5
    const predicted: [string, string, string, string] = ["A", "C", "B", "D"];
    expect(scoreGroupStanding(predicted, teams).scoreMultiplier).toBe(0.5);

    // 2nd correct, 1st wrong → should be 0
    const predicted2: [string, string, string, string] = ["B", "B", "C", "D"];
    expect(scoreGroupStanding(predicted2, teams).scoreMultiplier).toBe(0);
  });
});

// ─── earnedFromGroupStanding ────────────────────────────────────────────────

describe("earnedFromGroupStanding", () => {
  const actual: [string, string, string, string] = ["A", "B", "C", "D"];
  const prizePerGroup = 100;

  it("sole winner of perfect prediction gets full prize", () => {
    const earned = earnedFromGroupStanding(actual, actual, prizePerGroup, 1);
    expect(earned).toBe(100);
  });

  it("two winners of perfect prediction split the prize", () => {
    const earned = earnedFromGroupStanding(actual, actual, prizePerGroup, 2);
    expect(earned).toBe(50);
  });

  it("top-2 correct gives 75% of prize (sole winner)", () => {
    const predicted: [string, string, string, string] = ["A", "B", "D", "C"];
    const earned = earnedFromGroupStanding(predicted, actual, prizePerGroup, 1);
    expect(earned).toBe(75);
  });

  it("top-2 correct split among 3 winners", () => {
    const predicted: [string, string, string, string] = ["A", "B", "D", "C"];
    const earned = earnedFromGroupStanding(predicted, actual, prizePerGroup, 3);
    expect(earned).toBeCloseTo(25, 10);
  });

  it("1st correct gives 50% of prize", () => {
    const predicted: [string, string, string, string] = ["A", "C", "B", "D"];
    const earned = earnedFromGroupStanding(predicted, actual, prizePerGroup, 1);
    expect(earned).toBe(50);
  });

  it("wrong prediction earns 0", () => {
    const predicted: [string, string, string, string] = ["D", "C", "B", "A"];
    const earned = earnedFromGroupStanding(predicted, actual, prizePerGroup, 1);
    expect(earned).toBe(0);
  });

  it("returns 0 when no winners (edge case)", () => {
    const earned = earnedFromGroupStanding(actual, actual, prizePerGroup, 0);
    expect(earned).toBe(0);
  });
});

// ─── scoreKnockoutMatch ─────────────────────────────────────────────────────

describe("scoreKnockoutMatch", () => {
  it("exact score returns 1.0", () => {
    const r = scoreKnockoutMatch(2, 1, 2, 1);
    expect(r.scoreMultiplier).toBe(1.0);
    expect(r.label).toMatch(/exact/i);
  });

  it("correct winner returns 0.75", () => {
    const r = scoreKnockoutMatch(2, 0, 3, 1); // both home wins
    expect(r.scoreMultiplier).toBe(0.75);
    expect(r.label).toMatch(/winner/i);
  });

  it("correct draw returns 0.75", () => {
    const r = scoreKnockoutMatch(1, 1, 0, 0); // both draws
    expect(r.scoreMultiplier).toBe(0.75);
  });

  it("wrong result returns 0", () => {
    const r = scoreKnockoutMatch(1, 0, 0, 1);
    expect(r.scoreMultiplier).toBe(0);
  });

  it("exact draw returns 1.0", () => {
    const r = scoreKnockoutMatch(0, 0, 0, 0);
    expect(r.scoreMultiplier).toBe(1.0);
  });

  it("predicting home win when away win → 0", () => {
    const r = scoreKnockoutMatch(2, 1, 0, 1);
    expect(r.scoreMultiplier).toBe(0);
  });
});

// ─── earnedFromKOMatch ──────────────────────────────────────────────────────

describe("earnedFromKOMatch", () => {
  const matchPrize = 200;

  it("exact score, sole winner → full prize", () => {
    expect(earnedFromKOMatch(2, 1, 2, 1, matchPrize, 1)).toBe(200);
  });

  it("exact score, split between 4 → 50 each", () => {
    expect(earnedFromKOMatch(2, 1, 2, 1, matchPrize, 4)).toBe(50);
  });

  it("correct winner → 75% of prize", () => {
    expect(earnedFromKOMatch(2, 0, 3, 1, matchPrize, 1)).toBe(150);
  });

  it("correct winner, 3 share → 50 each", () => {
    expect(earnedFromKOMatch(2, 0, 3, 1, matchPrize, 3)).toBeCloseTo(50, 10);
  });

  it("wrong prediction → 0", () => {
    expect(earnedFromKOMatch(1, 0, 0, 1, matchPrize, 1)).toBe(0);
  });
});

// ─── scoreKnockoutMatchWithTeams ────────────────────────────────────────────
// The team-aware version: earning money requires predicting the correct winner
// team (derived from bracket simulation), not just matching score digits.

describe("scoreKnockoutMatchWithTeams", () => {
  it("correct team + exact score → 1.0", () => {
    const r = scoreKnockoutMatchWithTeams(2, 1, 2, 1, "tA", "tB", "tA", "tB");
    expect(r.scoreMultiplier).toBe(1.0);
    expect(r.label).toMatch(/exact/i);
  });

  it("correct team, wrong score → 0.75", () => {
    const r = scoreKnockoutMatchWithTeams(3, 0, 2, 1, "tA", "tB", "tA", "tB");
    expect(r.scoreMultiplier).toBe(0.75);
    expect(r.label).toMatch(/winner/i);
  });

  it("wrong winner team → 0, even if score digits match", () => {
    // Player predicted tB in home slot (wrong team), actual home is tA.
    // Both predict home wins 2-1, but the "home" team is different.
    const r = scoreKnockoutMatchWithTeams(2, 1, 2, 1, "tB", "tC", "tA", "tB");
    // predictedWinner = tB (home, 2>1), actualWinner = tA (home, 2>1) → mismatch
    expect(r.scoreMultiplier).toBe(0);
    expect(r.label).toMatch(/wrong/i);
  });

  it("correct winner team but teams swapped (home/away) → 0.75 not 1.0", () => {
    // Player predicted tA as away (score 1-2, away wins). Actual: tA is home, wins 2-1.
    // predictedWinner = tA (from away slot), actualWinner = tA (from home slot) → correct winner
    // But teams are in different slots → no exact score
    const r = scoreKnockoutMatchWithTeams(1, 2, 2, 1, "tB", "tA", "tA", "tB");
    expect(r.scoreMultiplier).toBe(0.75);
  });

  it("level score decided on penalties: same teams, same score, same shootout winner → 1.0", () => {
    const r = scoreKnockoutMatchWithTeams(1, 1, 1, 1, "tA", "tB", "tA", "tB", "home", "home");
    expect(r.scoreMultiplier).toBe(1.0);
  });

  it("level score, correct shootout winner team but wrong score → 0.75", () => {
    const r = scoreKnockoutMatchWithTeams(1, 1, 2, 2, "tA", "tB", "tA", "tB", "home", "home");
    expect(r.scoreMultiplier).toBe(0.75);
  });

  it("level score, predicted the WRONG penalty winner → 0", () => {
    // Predicted away (tB) on pens; actual home (tA) won the shootout → wrong winner.
    const r = scoreKnockoutMatchWithTeams(1, 1, 1, 1, "tA", "tB", "tA", "tB", "away", "home");
    expect(r.scoreMultiplier).toBe(0);
  });

  it("a level score with NO recorded shootout winner is undecided → 0", () => {
    const r = scoreKnockoutMatchWithTeams(1, 1, 1, 1, "tA", "tB", "tA", "tB");
    expect(r.scoreMultiplier).toBe(0);
  });

  it("predicted a draw won on pens by the team that actually LOST → 0", () => {
    // Predicted 1-1, away (tB) on pens; actual 2-1 home (tA) → wrong team advances.
    const r = scoreKnockoutMatchWithTeams(1, 1, 2, 1, "tA", "tB", "tA", "tB", "away");
    expect(r.scoreMultiplier).toBe(0);
  });

  it("predicted a draw won on pens by the team that actually advanced → 0.75", () => {
    // Predicted 1-1, home (tA) on pens; actual 2-1 home (tA) → right team, wrong score.
    const r = scoreKnockoutMatchWithTeams(1, 1, 2, 1, "tA", "tB", "tA", "tB", "home");
    expect(r.scoreMultiplier).toBe(0.75);
  });

  it("missing actual team ID → 0", () => {
    const r = scoreKnockoutMatchWithTeams(2, 1, 2, 1, "tA", "tB", null, "tB");
    expect(r.scoreMultiplier).toBe(0);
  });
});

// ─── prizePerSideBet ────────────────────────────────────────────────────────

describe("prizePerSideBet", () => {
  it("single side bet gets full Uber Pot", () => {
    expect(prizePerSideBet(300, 1)).toBe(300);
  });

  it("three side bets split equally", () => {
    expect(prizePerSideBet(300, 3)).toBe(100);
  });

  it("zero side bets returns 0", () => {
    expect(prizePerSideBet(300, 0)).toBe(0);
  });

  it("uneven split rounds correctly", () => {
    expect(prizePerSideBet(100, 3)).toBeCloseTo(33.333, 3);
  });
});
