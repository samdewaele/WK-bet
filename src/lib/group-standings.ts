export type TeamStanding = {
  teamId: string;
  name: string;
  flag: string;
  pts: number;
  gd: number;
  gf: number;
  w: number;
  d: number;
  l: number;
};

type MatchInput = {
  group: string | null;
  homeTeam: { id: string; name: string; flag: string } | null;
  awayTeam: { id: string; name: string; flag: string } | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
};

export function computeActualStandings(matches: MatchInput[]): Map<string, TeamStanding[]> {
  const statsMap = new Map<string, Map<string, TeamStanding>>();

  for (const m of matches) {
    if (
      !m.group ||
      !m.homeTeam ||
      !m.awayTeam ||
      m.homeScore === null ||
      m.awayScore === null ||
      m.status !== "finished"
    ) continue;

    if (!statsMap.has(m.group)) statsMap.set(m.group, new Map());
    const gMap = statsMap.get(m.group)!;

    if (!gMap.has(m.homeTeam.id)) {
      gMap.set(m.homeTeam.id, { teamId: m.homeTeam.id, name: m.homeTeam.name, flag: m.homeTeam.flag, pts: 0, gd: 0, gf: 0, w: 0, d: 0, l: 0 });
    }
    if (!gMap.has(m.awayTeam.id)) {
      gMap.set(m.awayTeam.id, { teamId: m.awayTeam.id, name: m.awayTeam.name, flag: m.awayTeam.flag, pts: 0, gd: 0, gf: 0, w: 0, d: 0, l: 0 });
    }

    const home = gMap.get(m.homeTeam.id)!;
    const away = gMap.get(m.awayTeam.id)!;
    home.gf += m.homeScore;
    away.gf += m.awayScore;
    home.gd += m.homeScore - m.awayScore;
    away.gd -= m.homeScore - m.awayScore;

    if (m.homeScore > m.awayScore)      { home.pts += 3; home.w++; away.l++; }
    else if (m.homeScore < m.awayScore) { away.pts += 3; away.w++; home.l++; }
    else                                { home.pts += 1; away.pts += 1; home.d++; away.d++; }
  }

  const result = new Map<string, TeamStanding[]>();
  for (const [group, teamMap] of statsMap) {
    result.set(
      group,
      [...teamMap.values()].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
    );
  }
  return result;
}
