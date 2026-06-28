/**
 * Bind R32 bracket slots to the real football-data fixtures by the deterministic
 * group-position "anchor" team.
 *
 * The app cannot guess which best-third-place team fills each eligible R32 slot
 * — FIFA's actual draw decides that, and the heuristic in ko-seeding gets it
 * wrong. But once the group stage is done, football-data publishes the real R32
 * matchups. Each of the 8 third-place slots pairs a group WINNER (fully
 * determined by standings) with a third-placer, so we find the fixture that
 * contains that winner and read off the real third-place team. Pure + testable.
 */

/** The 8 R32 slots whose away side is a best-third-place team, keyed by the
 *  group whose winner occupies the home side (the anchor). From R32_SLOTS. */
export const R32_THIRD_ANCHOR_GROUP: Record<number, string> = {
  74: "E",
  77: "I",
  79: "A",
  80: "L",
  81: "D",
  82: "G",
  85: "B",
  87: "K",
};

export type R32Fixture = { homeFdId: number | null; awayFdId: number | null };

/**
 * Given the football-data id of each group winner and the LAST_32 fixtures,
 * return matchNumber → the real third-place team's football-data id for each of
 * the 8 third-place slots. Slots whose anchor or fixture can't be resolved are
 * simply omitted (caller falls back to the heuristic for those).
 */
export function resolveR32ThirdPlace(
  winnerFdIdByGroup: Record<string, number>,
  fixtures: R32Fixture[],
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [matchNumberStr, group] of Object.entries(R32_THIRD_ANCHOR_GROUP)) {
    const anchorFd = winnerFdIdByGroup[group];
    if (anchorFd == null) continue;
    const fixture = fixtures.find(
      (f) => f.homeFdId === anchorFd || f.awayFdId === anchorFd,
    );
    if (!fixture) continue;
    const other = fixture.homeFdId === anchorFd ? fixture.awayFdId : fixture.homeFdId;
    if (other != null) out[Number(matchNumberStr)] = other;
  }
  return out;
}
