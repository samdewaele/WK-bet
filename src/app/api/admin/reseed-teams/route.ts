import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { TEAMS } from "@/lib/teams-data";

/**
 * POST /api/admin/reseed-teams
 *
 * Repairs the teams + group-stage matches in an existing database:
 *   1. Nullify homeTeamId/awayTeamId on group-stage matches for stale teams
 *   2. Delete stale teams (not in current TEAMS list)
 *   3. Upsert all current teams with correct names, flags, groups
 *   4. Delete and recreate all group-stage matches with correct pairings
 *   5. Leave KO placeholder matches and all user data untouched
 *
 * Platform admin only.
 */
export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const currentNames = new Set<string>(TEAMS.map((t) => t.name));

  // 1. Find stale team IDs (in DB but not in current TEAMS)
  const allDbTeams = await db.team.findMany({ select: { id: true, name: true } });
  const staleIds = allDbTeams.filter((t) => !currentNames.has(t.name)).map((t) => t.id);

  // 2. Nullify group-stage match references to stale teams
  if (staleIds.length > 0) {
    await db.match.updateMany({
      where: { round: "Group", homeTeamId: { in: staleIds } },
      data: { homeTeamId: null },
    });
    await db.match.updateMany({
      where: { round: "Group", awayTeamId: { in: staleIds } },
      data: { awayTeamId: null },
    });
    await db.team.deleteMany({ where: { id: { in: staleIds } } });
  }

  // 3. Upsert current teams (fixes group assignments + renames)
  for (const team of TEAMS) {
    await db.team.upsert({
      where: { name: team.name },
      create: team,
      update: team,
    });
  }

  // 4. Rebuild group-stage matches
  await db.match.deleteMany({ where: { round: "Group" } });

  const teamMap = new Map((await db.team.findMany()).map((t) => [t.name, t.id]));
  const groups = [...new Set(TEAMS.map((t) => t.group))].sort();
  const baseDate = new Date("2026-06-11T18:00:00Z");
  let matchNumber = 1;
  let i = 0;

  for (const group of groups) {
    const groupTeams = TEAMS.filter((t) => t.group === group);
    for (let a = 0; a < groupTeams.length; a++) {
      for (let b = a + 1; b < groupTeams.length; b++) {
        await db.match.create({
          data: {
            homeTeamId: teamMap.get(groupTeams[a].name)!,
            awayTeamId: teamMap.get(groupTeams[b].name)!,
            round: "Group",
            group,
            matchNumber,
            kickoff: new Date(baseDate.getTime() + i * 3 * 60 * 60 * 1000),
            status: "scheduled",
          },
        });
        matchNumber++;
        i++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    staleTeamsRemoved: staleIds.length,
    teamsUpserted: TEAMS.length,
    groupMatchesRebuilt: i,
  });
}
