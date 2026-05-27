import { describe, it, expect } from 'vitest';
import {
  calculatePoints,
  getMaxPoints,
  getRoundPoints,
  ROUND_ORDER,
  ROUND_LABELS,
  type Round,
} from '@/lib/points';

describe('ROUND_ORDER', () => {
  it('contains all 7 rounds in the correct order', () => {
    expect(ROUND_ORDER).toEqual(['Group', 'R32', 'R16', 'QF', 'SF', '3rd', 'Final']);
  });
});

describe('ROUND_LABELS', () => {
  it.each<[Round, string]>([
    ['Group', 'Group Stage'],
    ['R32', 'Round of 32'],
    ['R16', 'Round of 16'],
    ['QF', 'Quarter-finals'],
    ['SF', 'Semi-finals'],
    ['3rd', '3rd Place'],
    ['Final', 'Final'],
  ])('ROUND_LABELS[%s] === %s', (round, label) => {
    expect(ROUND_LABELS[round]).toBe(label);
  });
});

describe('getRoundPoints', () => {
  it.each<[Round, number, number]>([
    ['Group', 3, 2],
    ['R32', 5, 3],
    ['R16', 8, 4],
    ['QF', 12, 5],
    ['SF', 18, 6],
    ['3rd', 18, 6],
    ['Final', 25, 8],
  ])('getRoundPoints(%s) returns { result: %d, exact: %d }', (round, result, exact) => {
    expect(getRoundPoints(round)).toEqual({ result, exact });
  });
});

describe('getMaxPoints', () => {
  it.each<[Round, number]>([
    ['Group', 5],
    ['R32', 8],
    ['R16', 12],
    ['QF', 17],
    ['SF', 24],
    ['3rd', 24],
    ['Final', 33],
  ])('getMaxPoints(%s) === %d', (round, maxPts) => {
    expect(getMaxPoints(round)).toBe(maxPts);
  });
});

describe('calculatePoints', () => {
  describe('exact score (result + exact points)', () => {
    it.each<[Round, number]>([
      ['Group', 5],
      ['R32', 8],
      ['R16', 12],
      ['QF', 17],
      ['SF', 24],
      ['3rd', 24],
      ['Final', 33],
    ])('exact score in %s gives %d points', (round, expected) => {
      expect(calculatePoints(round, 2, 1, 2, 1)).toBe(expected);
    });

    it('exact draw score gives full points for Group', () => {
      expect(calculatePoints('Group', 1, 1, 1, 1)).toBe(5);
    });

    it('exact 0-0 draw gives full points', () => {
      expect(calculatePoints('Final', 0, 0, 0, 0)).toBe(33);
    });
  });

  describe('correct result only (result points)', () => {
    it.each<[Round, number]>([
      ['Group', 3],
      ['R32', 5],
      ['R16', 8],
      ['QF', 12],
      ['SF', 18],
      ['3rd', 18],
      ['Final', 25],
    ])('correct result only in %s gives %d points', (round, expected) => {
      // Pred: 2-0 (home win), Actual: 3-1 (home win) — same result, different score
      expect(calculatePoints(round, 2, 0, 3, 1)).toBe(expected);
    });

    it('correct draw result with different score gives result points for Group', () => {
      // Pred: 1-1 draw, Actual: 2-2 draw — same result, different score
      expect(calculatePoints('Group', 1, 1, 2, 2)).toBe(3);
    });

    it('correct away win result with different score gives result points', () => {
      // Pred: 0-1, Actual: 0-3
      expect(calculatePoints('QF', 0, 1, 0, 3)).toBe(12);
    });
  });

  describe('wrong result (0 points)', () => {
    it.each<Round>(['Group', 'R32', 'R16', 'QF', 'SF', '3rd', 'Final'])(
      'wrong result in %s gives 0 points',
      (round) => {
        // Pred: home win, Actual: away win
        expect(calculatePoints(round, 2, 0, 0, 1)).toBe(0);
      }
    );

    it('predicting home win when draw gives 0 points', () => {
      expect(calculatePoints('Group', 1, 0, 1, 1)).toBe(0);
    });

    it('predicting draw when away win gives 0 points', () => {
      expect(calculatePoints('SF', 1, 1, 0, 2)).toBe(0);
    });

    it('predicting away win when home win gives 0 points', () => {
      expect(calculatePoints('Final', 0, 1, 2, 0)).toBe(0);
    });
  });
});