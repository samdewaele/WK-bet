import { describe, it, expect } from "vitest";
import {
  resolveR32ThirdPlace,
  R32_THIRD_ANCHOR_GROUP,
  type R32Fixture,
} from "@/lib/ko-r32-binding";

// Real football-data.org LAST_32 fixtures (football-data team ids), captured
// from the live 2026 World Cup response. home = group winner/anchor in most.
const REAL_LAST_32: R32Fixture[] = [
  { homeFdId: 759, awayFdId: 761 },   // Germany (W E) v Paraguay (3rd D)
  { homeFdId: 773, awayFdId: 792 },   // France (W I) v Sweden (3rd F)
  { homeFdId: 774, awayFdId: 828 },   // South Africa (RU A) v Canada (RU B)
  { homeFdId: 8601, awayFdId: 815 },  // Netherlands (W F) v Morocco (RU C)
  { homeFdId: 765, awayFdId: 799 },   // Portugal (RU K) v Croatia (RU L)
  { homeFdId: 760, awayFdId: 816 },   // Spain (W H) v Austria (RU J)
  { homeFdId: 771, awayFdId: 1060 },  // United States (W D) v Bosnia (3rd B)
  { homeFdId: 805, awayFdId: 804 },   // Belgium (W G) v Senegal (3rd I)
  { homeFdId: 764, awayFdId: 766 },   // Brazil (W C) v Japan (RU F)
  { homeFdId: 1935, awayFdId: 8872 }, // Ivory Coast (RU E) v Norway (RU I)
  { homeFdId: 769, awayFdId: 791 },   // Mexico (W A) v Ecuador (3rd E)
  { homeFdId: 770, awayFdId: 1934 },  // England (W L) v Congo DR (3rd K)
  { homeFdId: 762, awayFdId: 1930 },  // Argentina (W J) v Cape Verde (RU H)
  { homeFdId: 779, awayFdId: 825 },   // Australia (RU D) v Egypt (RU G)
  { homeFdId: 788, awayFdId: 778 },   // Switzerland (W B) v Algeria (3rd J)
  { homeFdId: 818, awayFdId: 763 },   // Colombia (W K) v Ghana (3rd L)
];

// Group winners (football-data ids) computed from the real group results.
const WINNER_FD_BY_GROUP: Record<string, number> = {
  A: 769, // Mexico
  B: 788, // Switzerland
  C: 764, // Brazil
  D: 771, // United States
  E: 759, // Germany
  F: 8601, // Netherlands
  G: 805, // Belgium
  H: 760, // Spain
  I: 773, // France
  J: 762, // Argentina
  K: 818, // Colombia
  L: 770, // England
};

describe("resolveR32ThirdPlace", () => {
  it("reads the real third-place team for every third slot from football-data", () => {
    const thirds = resolveR32ThirdPlace(WINNER_FD_BY_GROUP, REAL_LAST_32);
    // Verified against the published bracket — these are the actual draws, NOT
    // what the app's MRV heuristic would have guessed.
    expect(thirds).toEqual({
      74: 761,  // Germany   → Paraguay   (3rd D)
      77: 792,  // France    → Sweden     (3rd F)
      79: 791,  // Mexico    → Ecuador    (3rd E)
      80: 1934, // England   → Congo DR   (3rd K)
      81: 1060, // USA       → Bosnia     (3rd B)
      82: 804,  // Belgium   → Senegal    (3rd I)
      85: 778,  // Switzerland → Algeria  (3rd J)
      87: 763,  // Colombia  → Ghana      (3rd L)
    });
  });

  it("resolves a third for all 8 third-place slots", () => {
    const thirds = resolveR32ThirdPlace(WINNER_FD_BY_GROUP, REAL_LAST_32);
    expect(Object.keys(thirds).map(Number).sort((a, b) => a - b)).toEqual(
      Object.keys(R32_THIRD_ANCHOR_GROUP).map(Number).sort((a, b) => a - b),
    );
  });

  it("works regardless of home/away orientation in the fixture", () => {
    // Flip every fixture's sides — the anchor match must still find the third.
    const flipped = REAL_LAST_32.map((f) => ({ homeFdId: f.awayFdId, awayFdId: f.homeFdId }));
    expect(resolveR32ThirdPlace(WINNER_FD_BY_GROUP, flipped)).toEqual(
      resolveR32ThirdPlace(WINNER_FD_BY_GROUP, REAL_LAST_32),
    );
  });

  it("omits a slot when its anchor winner isn't in any fixture", () => {
    const thirds = resolveR32ThirdPlace({ ...WINNER_FD_BY_GROUP, E: 999999 }, REAL_LAST_32);
    expect(thirds[74]).toBeUndefined(); // E winner unknown → slot 74 unresolved
    expect(thirds[77]).toBe(792);       // others unaffected
  });
});
