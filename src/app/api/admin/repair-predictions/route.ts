import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";

/**
 * POST /api/admin/repair-predictions
 *
 * Finds every GroupStandingPrediction where any position stores a teamId
 * that no longer exists in the Team table (because the team was deleted and
 * re-created with a new id during a reseed), then repairs it by deducing
 * which current team must occupy that slot.
 *
 * Logic: each group has exactly 4 teams. If a prediction for group X has a
 * position pointing at a stale id, the correct team is the one valid team
 * for group X that isn't already used in one of the other three positions.
 */
export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Build a map of group → Set<teamId> from the current Team table.
  const allTeams = await db.team.findMany({ select: { id: true, group: true } });
  const validIdsByGroup = new Map<string, Set<string>>();
  for (const t of allTeams) {
    if (!validIdsByGroup.has(t.group)) validIdsByGroup.set(t.group, new Set());
    validIdsByGroup.get(t.group)!.add(t.id);
  }

  const allPredictions = await db.groupStandingPrediction.findMany();

  let repaired = 0;
  let skipped = 0;
  const details: string[] = [];

  for (const pred of allPredictions) {
    const validIds = validIdsByGroup.get(pred.wcGroup);
    if (!validIds) continue;

    const keys = ["position1", "position2", "position3", "position4"] as const;
    const values = [pred.position1, pred.position2, pred.position3, pred.position4];

    const brokenPositions = keys.filter((_, i) => !validIds.has(values[i]));
    if (brokenPositions.length === 0) continue;

    // Which valid teams are NOT already in a valid position?
    const usedValid = new Set(values.filter((id) => validIds.has(id)));
    const missingTeams = [...validIds].filter((id) => !usedValid.has(id));

    if (missingTeams.length !== brokenPositions.length) {
      // Can't determine the correct mapping unambiguously — skip and log.
      skipped++;
      details.push(`Skipped prediction ${pred.id} (group ${pred.wcGroup}): ${brokenPositions.length} broken, ${missingTeams.length} missing teams`);
      continue;
    }

    // One broken position → one missing team: safe to map directly.
    const update: Record<string, string> = {};
    for (let i = 0; i < brokenPositions.length; i++) {
      update[brokenPositions[i]] = missingTeams[i];
    }

    await db.groupStandingPrediction.update({ where: { id: pred.id }, data: update });
    repaired++;
  }

  return NextResponse.json({
    ok: true,
    repaired,
    skipped,
    details,
    message: `Repaired ${repaired} prediction(s) with stale team IDs. ${skipped > 0 ? `${skipped} could not be resolved unambiguously.` : ""}`,
  });
}
