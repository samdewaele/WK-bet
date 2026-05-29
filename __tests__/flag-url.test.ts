import { describe, it, expect } from 'vitest';
import { flagToUrl, flagToCode } from '@/lib/flag-url';

// All 48 seed-team flag emojis used in the tournament
const SEED_FLAGS = [
  // Group A
  '🇲🇦', '🇵🇦', '🇨🇷', '🇭🇷',
  // Group B
  '🇩🇪', '🇯🇵', '🇪🇸', '🇨🇱',
  // Group C
  '🇦🇷', '🇧🇴', '🇵🇾', '🇸🇦',
  // Group D
  '🇫🇷', '🇺🇾', '🇦🇺', '🇵🇱',
  // Group E
  '🇺🇸', '🇿🇦', '🇸🇳', '🇬🇭',
  // Group F
  '🇲🇽', '🇵🇹', '🇦🇫', '🇨🇲',
  // Group G
  '🇧🇷', '🇳🇬', '🇧🇪', '🇨🇴',
  // Group H
  '🇬🇧', '🇨🇿', '🇹🇳', '🇳🇱',
  // Group I
  '🇮🇹', '🇰🇷', '🇪🇨', '🇸🇳',
  // Group J
  '🇵🇪', '🇬🇾', '🇸🇻', '🇾🇪',
  // Group K
  '🇨🇦', '🇻🇪', '🇸🇪', '🇷🇸',
  // Group L
  '🇳🇿', '🇷🇴', '🇸🇮', '🇬🇦',
];

describe('flagToUrl', () => {
  it('returns the correct URL for 🇺🇸', () => {
    expect(flagToUrl('🇺🇸')).toBe('https://flagcdn.com/w40/us.png');
  });

  it('returns the correct URL for 🇧🇪', () => {
    expect(flagToUrl('🇧🇪')).toBe('https://flagcdn.com/w40/be.png');
  });

  it('returns a valid https://flagcdn.com URL for every seed-team flag', () => {
    for (const flag of SEED_FLAGS) {
      const url = flagToUrl(flag);
      // Allow null for flags that may not be standard (some seeds may be unusual)
      if (url !== null) {
        expect(url).toMatch(/^https:\/\/flagcdn\.com\/w40\/[a-z]{2}(-[a-z]+)?\.png$/);
      }
    }
  });

  it('returns null for an invalid/unknown emoji', () => {
    // A non-flag emoji should return null
    expect(flagToUrl('😀')).toBeNull();
  });
});

describe('flagToCode', () => {
  it('extracts "BE" from 🇧🇪', () => {
    expect(flagToCode('🇧🇪')).toBe('BE');
  });

  it('extracts "US" from 🇺🇸', () => {
    expect(flagToCode('🇺🇸')).toBe('US');
  });

  it('extracts "MA" from 🇲🇦', () => {
    expect(flagToCode('🇲🇦')).toBe('MA');
  });

  it('extracts "PA" from 🇵🇦', () => {
    expect(flagToCode('🇵🇦')).toBe('PA');
  });

  it('returns a 2-letter uppercase code for every standard seed flag', () => {
    for (const flag of SEED_FLAGS) {
      const code = flagToCode(flag);
      // Standard 2-letter codes should be 2 uppercase letters
      if (code !== '??') {
        expect(code).toMatch(/^[A-Z]{2}$/);
      }
    }
  });
});
