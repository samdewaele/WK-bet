import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { fetchWCMatches } from "@/lib/football-data";

/**
 * POST /api/admin/repair-groups
 *
 * Fixes the `group` field on every group-stage Match row where the DB value
 * doesn't match the letter the football-data.org API reports.  This is needed
 * when a match was created/seeded while the API hadn't assigned a group yet
 * (group: null) and subsequent syncs skipped it because status+score were
 * already correct (unchanged = true).
 */
export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let apiMatches;
  try {
    apiMatches = await fetchWCMatches();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  const dbMatches = await db.match.findMany({
    where: { round: "Group", fdMatchId: { not: null } },
    select: { id: true, fdMatchId: true, group: true },
  });

  const apiById = new Map(apiMatches.map((m) => [m.id, m]));

  let fixed = 0;
  let skipped = 0;
  const details: string[] = [];

  for (const dbm of dbMatches) {
    const api = apiById.get(dbm.fdMatchId!);
    if (!api?.group) { skipped++; continue; }

    const correctGroup = api.group.replace(/^GROUP_/, "");
    if (dbm.group === correctGroup) continue;

    await db.match.update({ where: { id: dbm.id }, data: { group: correctGroup } });
    details.push(`fdMatchId=${dbm.fdMatchId}: "${dbm.group ?? "null"}" → "${correctGroup}"`);
    fixed++;
  }

  return NextResponse.json({
    ok: true,
    fixed,
    skipped,
    details,
    message: `Fixed ${fixed} match group field(s).${skipped > 0 ? ` ${skipped} skipped (no API group data).` : ""}`,
  });
}
