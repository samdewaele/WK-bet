// Convert flag emoji to flagcdn.com URL for cross-platform rendering
export function flagToUrl(flag: string): string | null {
  const codePoints = [...flag].map(c => c.codePointAt(0) ?? 0);
  // Standard country flag: 2 regional indicator symbols
  if (
    codePoints.length === 2 &&
    codePoints[0] >= 0x1F1E6 && codePoints[0] <= 0x1F1FF &&
    codePoints[1] >= 0x1F1E6 && codePoints[1] <= 0x1F1FF
  ) {
    const a = String.fromCharCode(codePoints[0] - 0x1F1E6 + 65).toLowerCase();
    const b = String.fromCharCode(codePoints[1] - 0x1F1E6 + 65).toLowerCase();
    return `https://flagcdn.com/w40/${a}${b}.png`;
  }
  // England 🏴󠁧󠁢󠁥󠁮󠁧󠁿 special case
  if (flag.includes('\u{E0065}\u{E006E}\u{E0067}')) return 'https://flagcdn.com/w40/gb-eng.png';
  // Scotland 🏴󠁧󠁢󠁳󠁣󠁴󠁿 special case
  if (flag.includes('\u{E0073}\u{E0063}\u{E0074}')) return 'https://flagcdn.com/w40/gb-sct.png';
  // Wales 🏴󠁧󠁢󠁷󠁬󠁳󠁿 special case
  if (flag.includes('\u{E0077}\u{E006C}\u{E0073}')) return 'https://flagcdn.com/w40/gb-wls.png';
  return null;
}
