import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { TEAMS } from "@/lib/teams-data";
import { fetchWCMatches, teamNameMatches } from "@/lib/football-data";
import type { FDTeam } from "@/lib/football-data";

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

export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── 1. Fetch group-stage matches from football-data.org ──────────────────
  let allApiMatches;
  try {
    allApiMatches = await fetchWCMatches();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  const apiGroupMatches = allApiMatches
    .filter((m) => m.stage === "GROUP_STAGE")
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());

  if (apiGroupMatches.length === 0) {
    return NextResponse.json({ error: "API returned no group-stage matches" }, { status: 502 });
  }

  // ── 2. Upsert teams ───────────────────────────────────────────────────────
  // Build set of unique API teams from the group matches.
  const apiTeamsById = new Map<number, FDTeam>();
  for (const m of apiGroupMatches) {
    apiTeamsById.set(m.homeTeam.id, m.homeTeam);
    apiTeamsById.set(m.awayTeam.id, m.awayTeam);
  }

  let teamsUpserted = 0;
  let teamsUnmatched = 0;
  const teamIdByFdId = new Map<number, string>(); // fdId → DB team.id

  for (const [fdId, apiTeam] of apiTeamsById) {
    // Try to find a local entry for display name + flag.
    // If matching fails we fall back to the API name and a placeholder flag —
    // a team with an ugly flag is far better than a team that silently disappears.
    const local = TEAMS.find((t) => teamNameMatches(t.name, apiTeam));
    if (!local) teamsUnmatched++;
    const name  = local?.name  ?? apiTeam.name;
    const flag  = local?.flag  ?? "🏳️";
    // Group letter comes from the match data, not the local list.
    const group = apiGroupMatches.find(
      (m) => m.homeTeam.id === fdId || m.awayTeam.id === fdId
    )?.group?.replace(/^GROUP_/, "") ?? "?";

    // Find an existing row by fdId first, then by resolved name.
    // Legacy rows were seeded from the TEAMS array with fdId = null, so
    // a plain upsert({ where: { fdId } }) would try to INSERT and hit the
    // unique-name constraint. We find-then-update instead.
    const existing =
      await db.team.findUnique({ where: { fdId } }) ??
      await db.team.findUnique({ where: { name } });

    if (existing) {
      await db.team.update({ where: { id: existing.id }, data: { fdId, name, flag, group } });
      teamIdByFdId.set(fdId, existing.id);
    } else {
      const created = await db.team.create({ data: { fdId, name, flag, group } });
      teamIdByFdId.set(fdId, created.id);
    }
    teamsUpserted++;
  }

  // ── 3. Remove teams that are not in the TEAMS local array ────────────────
  const allDbTeams = await db.team.findMany({ select: { id: true, name: true } });
  const staleIds = allDbTeams.filter((t) => !TEAMS.some((local) => local.name === t.name)).map((t) => t.id);
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
    message: `Created ${groupMatchesCreated} group matches from API with fdMatchId set. ${teamsUnmatched > 0 ? `${teamsUnmatched} team(s) had no local name/flag match and used the API name with placeholder flag 🏳️.` : "All teams matched local display names."}`,
  });
}
