export type Round = "Group" | "R32" | "R16" | "QF" | "SF" | "3rd" | "Final";

const POINTS: Record<Round, { result: number; exact: number }> = {
  Group: { result: 3, exact: 2 },
  R32:   { result: 5, exact: 3 },
  R16:   { result: 8, exact: 4 },
  QF:    { result: 12, exact: 5 },
  SF:    { result: 18, exact: 6 },
  "3rd": { result: 18, exact: 6 },
  Final: { result: 25, exact: 8 },
};

export const ROUND_LABELS: Record<Round, string> = {
  Group: "Group Stage",
  R32:   "Round of 32",
  R16:   "Round of 16",
  QF:    "Quarter-finals",
  SF:    "Semi-finals",
  "3rd": "3rd Place",
  Final: "Final",
};

export const ROUND_ORDER: Round[] = ["Group", "R32", "R16", "QF", "SF", "3rd", "Final"];

function getResult(home: number, away: number): "home" | "draw" | "away" {
  if (home > away) return "home";
  if (home < away) return "away";
  return "draw";
}

export function calculatePoints(
  round: Round,
  predHome: number,
  predAway: number,
  actualHome: number,
  actualAway: number,
): number {
  const config = POINTS[round];
  const predResult = getResult(predHome, predAway);
  const actualResult = getResult(actualHome, actualAway);

  if (predHome === actualHome && predAway === actualAway) {
    return config.result + config.exact;
  }
  if (predResult === actualResult) {
    return config.result;
  }
  return 0;
}

export function getMaxPoints(round: Round): number {
  const config = POINTS[round];
  return config.result + config.exact;
}

export function getRoundPoints(round: Round) {
  return POINTS[round];
}
