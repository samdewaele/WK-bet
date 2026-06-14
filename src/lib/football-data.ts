// Client for football-data.org v4 API
// Docs: https://docs.football-data.org/general/v4/index.html
// Free tier: 10 req/min. Set FOOTBALL_DATA_API_KEY as a Fly secret.

export type FDTeam = { id: number; name: string; shortName: string; tla: string };

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
  stage: string; // e.g. "GROUP_STAGE", "LAST_32", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "THIRD_PLACE", "FINAL"
  group: string | null; // e.g. "GROUP_A" for group stage, null for KO rounds
  homeTeam: FDTeam;
  awayTeam: FDTeam;
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

export function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+and\s+/g, " ")
    .replace(/-/g, " ")
    .replace(/[''`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const TEAM_ALIASES = new Map<string, string[]>([
  ["Côte d'Ivoire", ["Ivory Coast", "Cote d Ivoire", "Cote dIvoire"]],
  ["Congo DR",      ["DR Congo", "DRC", "Congo DRC", "Democratic Republic Congo", "Democratic Republic of Congo"]],
  ["Türkiye",       ["Turkey", "Turkiye"]],
  ["Cabo Verde",    ["Cape Verde"]],
]);

export function teamNameMatches(dbName: string, api: FDTeam): boolean {
  if (!api.name && !api.shortName) return false;
  const apiName  = api.name      ?? "";
  const apiShort = api.shortName ?? "";
  const dbLower  = dbName.toLowerCase();
  const dbNorm   = normName(dbName);
  if (
    dbLower === apiName.toLowerCase()  ||
    dbLower === apiShort.toLowerCase() ||
    dbLower === (api.tla ?? "").toLowerCase() ||
    dbLower.includes(apiShort.toLowerCase()) ||
    apiName.toLowerCase().includes(dbLower) ||
    apiShort.toLowerCase().includes(dbLower) ||
    dbNorm === normName(apiName) ||
    dbNorm === normName(apiShort)
  ) return true;
  const aliases = TEAM_ALIASES.get(dbName) ?? [];
  return aliases.some((alias) => {
    const an = alias.toLowerCase();
    return (
      an === apiName.toLowerCase()  ||
      an === apiShort.toLowerCase() ||
      normName(alias) === normName(apiName) ||
      normName(alias) === normName(apiShort)
    );
  });
}

