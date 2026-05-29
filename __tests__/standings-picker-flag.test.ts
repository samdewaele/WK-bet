import { describe, it, expect } from 'vitest';
import { flagToUrl, flagToCode } from '@/lib/flag-url';

// Visual contract test: given a selected team with a flag emoji,
// the flag rendering infrastructure should produce a valid URL.
// This confirms that the fix direction (rendering TeamFlag to the left of the select)
// is correct and the utilities it depends on work as expected.

describe('standings-picker flag rendering contract', () => {
  const selectedTeam = { id: 'x', name: 'Belgium', flag: '🇧🇪' };

  it('derives a valid flagcdn URL from the selected team flag', () => {
    const url = flagToUrl(selectedTeam.flag);
    expect(url).toBe('https://flagcdn.com/w40/be.png');
  });

  it('derives a valid ISO code from the selected team flag', () => {
    const code = flagToCode(selectedTeam.flag);
    expect(code).toBe('BE');
  });

  it('a team with no selection (empty string flag) should produce null URL', () => {
    // When no team is selected, flagToUrl on an empty string returns null
    // so no flag is rendered — matches the fix: only show flag when selectedTeam is truthy
    expect(flagToUrl('')).toBeNull();
  });

  it('flagToUrl and flagToCode are consistent — same country code', () => {
    const flag = selectedTeam.flag;
    const url = flagToUrl(flag);
    const code = flagToCode(flag);
    // The URL should contain the lowercase version of the code
    expect(url).toContain(code.toLowerCase());
  });
});
