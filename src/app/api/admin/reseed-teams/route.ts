import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { TEAMS } from "@/lib/teams-data";

/**
 * POST /api/admin/reseed-teams
 *
 * Rebuilds the teams + group-stage matches table using football-data.org as
 * the authoritative source:
 *   1. Fetch all group-stage matches from the API
 *   2. Upsert Team rows (keeps existing flags from TEAMS; sets fdId from API)
 *   3. Delete and recreate all group-stage Match rows with fdMatchId set from
 *      the start — no separate backfill step, no home/away guessing
 *   4. Leave KO placeholder matches and all user data untouched
 *
 * Platform admin only.
 */

type ApiTeam = { id: number; name: string; shortName: string; tla: string };
type ApiMatch = {
  id: number;
  utcDate: string;
  stage: string;
  group: string | null;
  homeTeam: ApiTeam;
  awayTeam: ApiTeam;
};

function normName(s: string): string {
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

const TEAM_ALIASES = new Map<string, string[]>([
  ["Côte d'Ivoire", ["Ivory Coast", "Cote d Ivoire", "Cote dIvoire"]],
  ["Congo DR",      ["DR Congo", "DRC", "Congo DRC", "Democratic Republic Congo", "Democratic Republic of Congo"]],
]);

/** Find the TEAMS entry whose name matches an API team (by norm or alias). */
function findLocalTeam(api: ApiTeam) {
  const apiNorm = normName(api.name);
  const apiShortNorm = normName(api.shortName);
  return TEAMS.find((t) => {
    if (normName(t.name) === apiNorm || normName(t.name) === apiShortNorm) return true;
    const aliases = TEAM_ALIASES.get(t.name) ?? [];
    return aliases.some((a) => normName(a) === apiNorm || normName(a) === apiShortNorm);
  });
}

export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "FOOTBALL_DATA_API_KEY is not set — cannot seed from API" }, { status: 502 });
  }

  // ── 1. Fetch group-stage matches from football-data.org ──────────────────
  const resp = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
    headers: { "X-Auth-Token": apiKey },
    cache: "no-store",
  });
  if (!resp.ok) {
    return NextResponse.json({ error: `football-data.org returned ${resp.status}` }, { status: 502 });
  }
  const data = await resp.json();
  const apiGroupMatches = ((data.matches ?? []) as ApiMatch[])
    .filter((m) => m.stage === "GROUP_STAGE")
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());

  if (apiGroupMatches.length === 0) {
    return NextResponse.json({ error: "API returned no group-stage matches" }, { status: 502 });
  }

  // ── 2. Upsert teams ───────────────────────────────────────────────────────
  // Build set of unique API teams from the group matches.
  const apiTeamsById = new Map<number, ApiTeam>();
  for (const m of apiGroupMatches) {
    apiTeamsById.set(m.homeTeam.id, m.homeTeam);
    apiTeamsById.set(m.awayTeam.id, m.awayTeam);
  }

  let teamsUpserted = 0;
  let teamsUnmatched = 0;
  const teamIdByFdId = new Map<number, string>(); // fdId → DB team.id

  for (const [fdId, apiTeam] of apiTeamsById) {
    const local = findLocalTeam(apiTeam);
    if (!local) {
      teamsUnmatched++;
      continue;
    }
    const upserted = await db.team.upsert({
      where: { name: local.name },
      create: { name: local.name, flag: local.flag, group: local.group, fdId },
      update: { flag: local.flag, group: local.group, fdId },
    });
    teamIdByFdId.set(fdId, upserted.id);
    teamsUpserted++;
  }

  // ── 3. Remove stale teams (in DB but not referenced by any API group match) ──
  const currentApiNames: Set<string> = new Set(
    [...apiTeamsById.values()].flatMap((t) => {
      const local = findLocalTeam(t);
      return local ? [local.name] : [];
    })
  );
  const allDbTeams = await db.team.findMany({ select: { id: true, name: true } });
  const staleIds = allDbTeams.filter((t) => !currentApiNames.has(t.name)).map((t) => t.id);
  if (staleIds.length > 0) {
    await db.match.updateMany({ where: { round: "Group", homeTeamId: { in: staleIds } }, data: { homeTeamId: null } });
    await db.match.updateMany({ where: { round: "Group", awayTeamId: { in: staleIds } }, data: { awayTeamId: null } });
    await db.team.deleteMany({ where: { id: { in: staleIds } } });
  }

  // ── 4. Rebuild group-stage matches from API ───────────────────────────────
  await db.match.deleteMany({ where: { round: "Group" } });

  // matchNumber must not collide with KO matches (which start at 49 in a 48+56 tournament).
  // Assign 1–N for the N group matches in chronological order.
  let matchNumber = 1;
  let groupMatchesCreated = 0;

  for (const apiM of apiGroupMatches) {
    const homeTeamId = teamIdByFdId.get(apiM.homeTeam.id) ?? null;
    const awayTeamId = teamIdByFdId.get(apiM.awayTeam.id) ?? null;
    // "GROUP_A" → "A"
    const groupLetter = apiM.group ? apiM.group.replace(/^GROUP_/, "") : null;

    await db.match.create({
      data: {
        fdMatchId: apiM.id,
        homeTeamId,
        awayTeamId,
        round: "Group",
        group: groupLetter,
        matchNumber,
        kickoff: new Date(apiM.utcDate),
        status: "scheduled",
      },
    });
    matchNumber++;
    groupMatchesCreated++;
  }

  return NextResponse.json({
    ok: true,
    staleTeamsRemoved: staleIds.length,
    teamsUpserted,
    teamsUnmatched,
    groupMatchesCreated,
    message: `Created ${groupMatchesCreated} group matches directly from API with fdMatchId set. ${teamsUnmatched > 0 ? `${teamsUnmatched} API teams had no local match (check TEAM_ALIASES).` : "All teams matched."}`,
  });
}
