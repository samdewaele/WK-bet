/**
 * Official FIFA World Cup 2026 knockout schedule — the team-independent source
 * of truth for KO kickoff times.
 *
 * Every bracket slot (match number 73–104) has a FIXED date/stadium decided by
 * FIFA before anyone knows who plays it, so the schedule must NOT be inferred
 * from teams or from football-data's per-fixture rows (whose ids are scrambled
 * relative to the bracket and whose later-round teams are unknown). These UTC
 * kickoffs were taken from the official bracket on Wikipedia and cross-checked
 * to the minute against the football-data.org fixtures.
 *
 * Stadiums are intentionally omitted — only dates are shown in the app.
 */
export const KO_SCHEDULE: Record<number, string> = {
  // Round of 32
  73: "2026-06-28T19:00:00Z",
  74: "2026-06-29T20:30:00Z",
  75: "2026-06-30T01:00:00Z",
  76: "2026-06-29T17:00:00Z",
  77: "2026-06-30T21:00:00Z",
  78: "2026-06-30T17:00:00Z",
  79: "2026-07-01T01:00:00Z",
  80: "2026-07-01T16:00:00Z",
  81: "2026-07-02T00:00:00Z",
  82: "2026-07-01T20:00:00Z",
  83: "2026-07-02T23:00:00Z",
  84: "2026-07-02T19:00:00Z",
  85: "2026-07-03T03:00:00Z",
  86: "2026-07-03T22:00:00Z",
  87: "2026-07-04T01:30:00Z",
  88: "2026-07-03T18:00:00Z",
  // Round of 16
  89: "2026-07-04T21:00:00Z",
  90: "2026-07-04T17:00:00Z",
  91: "2026-07-05T20:00:00Z",
  92: "2026-07-06T00:00:00Z",
  93: "2026-07-06T19:00:00Z",
  94: "2026-07-07T00:00:00Z",
  95: "2026-07-07T16:00:00Z",
  96: "2026-07-07T20:00:00Z",
  // Quarter-finals
  97: "2026-07-09T20:00:00Z",
  98: "2026-07-10T19:00:00Z",
  99: "2026-07-11T21:00:00Z",
  100: "2026-07-12T01:00:00Z",
  // Semi-finals
  101: "2026-07-14T19:00:00Z",
  102: "2026-07-15T19:00:00Z",
  // Third-place play-off + Final
  103: "2026-07-18T21:00:00Z",
  104: "2026-07-19T19:00:00Z",
};

/** Official kickoff (ISO UTC) for a KO match number, or null if not a KO slot. */
export function koScheduledKickoff(matchNumber: number | null | undefined): string | null {
  if (matchNumber == null) return null;
  return KO_SCHEDULE[matchNumber] ?? null;
}
