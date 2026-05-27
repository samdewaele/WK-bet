export type KORound = "R32" | "R16" | "QF" | "SF" | "3rd" | "Final";

// KO pot is divided into 5 equal units:
//   R32=1 unit (16 matches), R16=1 unit (8 matches),
//   QF=1 unit (4 matches),   SF=1 unit (2 matches),
//   Finals=1 unit split as 3rd(1/3) + Final(2/3)
// Total = 5 units. Per-match prize doubles each round.
export const KO_MATCH_WEIGHT: Record<KORound, number> = {
  R32:   1 / 16,
  R16:   1 / 8,
  QF:    1 / 4,
  SF:    1 / 2,
  "3rd": 1 / 3,
  Final: 2 / 3,
};

export const KO_ROUNDS: KORound[] = ["R32", "R16", "QF", "SF", "3rd", "Final"];

// Verify weights sum to 5 units (sanity check):
// 16*(1/16) + 8*(1/8) + 4*(1/4) + 2*(1/2) + 1*(1/3) + 1*(2/3) = 1+1+1+1+1 = 5 ✓

export interface PotBreakdown {
  totalPot: number;
  groupStagePot: number;
  knockoutPot: number;
  prizePerWCGroup: number;
  koUnit: number;
  prizePerKOMatch: Record<KORound, number>;
}

export function calculatePot(entryFee: number, memberCount: number): PotBreakdown {
  const totalPot = entryFee * memberCount;
  const groupStagePot = totalPot * 0.5;
  const knockoutPot = totalPot * 0.5;
  const prizePerWCGroup = groupStagePot / 12;
  const koUnit = knockoutPot / 5;

  const prizePerKOMatch = Object.fromEntries(
    KO_ROUNDS.map((r) => [r, koUnit * KO_MATCH_WEIGHT[r]])
  ) as Record<KORound, number>;

  return { totalPot, groupStagePot, knockoutPot, prizePerWCGroup, koUnit, prizePerKOMatch };
}

// --- Group standing scoring ---

export interface GroupStandingResult {
  scoreMultiplier: number; // 0 | 0.5 | 0.75 | 1.0
  label: string;
}

export function scoreGroupStanding(
  predicted: [string, string, string, string],
  actual: [string, string, string, string]
): GroupStandingResult {
  const allCorrect = predicted.every((t, i) => t === actual[i]);
  if (allCorrect) return { scoreMultiplier: 1.0, label: "All 4 correct" };

  const top2Correct = predicted[0] === actual[0] && predicted[1] === actual[1];
  if (top2Correct) return { scoreMultiplier: 0.75, label: "Top 2 correct" };

  const top1Correct = predicted[0] === actual[0];
  if (top1Correct) return { scoreMultiplier: 0.5, label: "1st place correct" };

  return { scoreMultiplier: 0, label: "No match" };
}

export function earnedFromGroupStanding(
  predicted: [string, string, string, string],
  actual: [string, string, string, string],
  prizePerGroup: number,
  winnersCount: number
): number {
  const { scoreMultiplier } = scoreGroupStanding(predicted, actual);
  if (scoreMultiplier === 0 || winnersCount === 0) return 0;
  return (prizePerGroup * scoreMultiplier) / winnersCount;
}

// --- Knockout match scoring ---

function getMatchWinner(home: number, away: number): "home" | "away" | "draw" {
  if (home > away) return "home";
  if (home < away) return "away";
  return "draw";
}

export interface KOMatchResult {
  scoreMultiplier: number; // 0 | 0.75 | 1.0
  label: string;
}

export function scoreKnockoutMatch(
  predHome: number,
  predAway: number,
  actualHome: number,
  actualAway: number
): KOMatchResult {
  if (predHome === actualHome && predAway === actualAway) {
    return { scoreMultiplier: 1.0, label: "Exact score" };
  }
  if (getMatchWinner(predHome, predAway) === getMatchWinner(actualHome, actualAway)) {
    return { scoreMultiplier: 0.75, label: "Correct winner" };
  }
  return { scoreMultiplier: 0, label: "Wrong" };
}

export function earnedFromKOMatch(
  predHome: number,
  predAway: number,
  actualHome: number,
  actualAway: number,
  matchPrize: number,
  winnersCount: number
): number {
  const { scoreMultiplier } = scoreKnockoutMatch(predHome, predAway, actualHome, actualAway);
  if (scoreMultiplier === 0 || winnersCount === 0) return 0;
  return (matchPrize * scoreMultiplier) / winnersCount;
}

// --- Uber Pot ---

export interface UberPotInput {
  pot: PotBreakdown;
  // Per WC group: how much was actually distributed
  groupDistributed: Record<string, number>;
  // Per match ID: how much was actually distributed
  koDistributed: Record<string, number>;
}

export function calculateUberPot({
  pot,
  groupDistributed,
  koDistributed,
}: UberPotInput): number {
  const groupUnclaimed = Object.values(groupDistributed).reduce(
    (sum, distributed) => sum + (pot.prizePerWCGroup - distributed),
    0
  );
  const koUnclaimed = Object.values(koDistributed).reduce(
    (sum, distributed) => sum + distributed,  // already represents "undistributed" portions
    0
  );
  return Math.max(0, groupUnclaimed + koUnclaimed);
}

// Prize per side bet = uberPot / number of side bets (equal split)
export function prizePerSideBet(uberPot: number, sideBetCount: number): number {
  if (sideBetCount === 0) return 0;
  return uberPot / sideBetCount;
}
