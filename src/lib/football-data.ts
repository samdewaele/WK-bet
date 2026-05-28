// Client for football-data.org v4 API
// Docs: https://docs.football-data.org/general/v4/index.html
// Free tier: 10 req/min. Set FOOTBALL_DATA_API_KEY as a Fly secret.

export type FDMatch = {
  id: number;
  utcDate: string; // ISO-8601
  status:
    | "SCHEDULED"
    | "TIMED"
    | "IN_PLAY"
    | "PAUSED"
    | "HALFTIME"
    | "FINISHED"
    | "POSTPONED"
    | "CANCELLED"
    | "SUSPENDED";
  homeTeam: { id: number; name: string; shortName: string; tla: string };
  awayTeam: { id: number; name: string; shortName: string; tla: string };
  score: {
    winner: "HOME_TEAM" | "AWAY_TEAM" | "DRAW" | null;
    fullTime: { home: number | null; away: number | null };
  };
};

export async function fetchWCMatches(): Promise<FDMatch[]> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) throw new Error("FOOTBALL_DATA_API_KEY is not set");

  const res = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
    headers: { "X-Auth-Token": apiKey },
    cache: "no-store",
  });

  if (res.status === 429) throw new Error("Rate limited — try again in a minute");
  if (!res.ok) throw new Error(`football-data.org returned ${res.status}`);

  const data = await res.json();
  return (data.matches ?? []) as FDMatch[];
}

// Maps football-data.org status to our match status
export function mapStatus(apiStatus: FDMatch["status"]): "scheduled" | "live" | "finished" {
  if (["IN_PLAY", "PAUSED", "HALFTIME"].includes(apiStatus)) return "live";
  if (apiStatus === "FINISHED") return "finished";
  return "scheduled";
}
