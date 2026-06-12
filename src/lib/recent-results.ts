export type RecentMatch = {
  id: string;
  round: string;
  group: string | null;
  kickoff: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  homeTeam: { id: string; name: string; flag: string } | null;
  awayTeam: { id: string; name: string; flag: string } | null;
};

export function filterRecentResults(matches: RecentMatch[], limit = 5): RecentMatch[] {
  return matches
    .filter((m) => m.status === "finished" && m.homeTeam !== null && m.awayTeam !== null)
    .sort((a, b) => new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime())
    .slice(0, limit);
}
