/**
 * E2E-only endpoint for running a preset (deterministic) tournament simulation.
 * All group and KO matches use preset scores: home=2, away=0.
 *
 * This produces fully deterministic standings:
 *   Group A: USA > Panama > Honduras > Morocco
 *   Group B: Argentina > Chile > Peru > Australia
 *   ... (first team listed in each group wins all home matches)
 *
 * Total group goals = 72 matches × 2 = 144.
 *
 * Only active when E2E_TEST=true.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  calculatePot,
  scoreGroupStanding,
  earnedFromGroupStanding,
  earnedFromKOMatch,
  KO_ROUNDS,
  type KORound,
} from "@/lib/pot";
import {
  buildStandingsFromMatches,
  populateR32Bracket,
  populateNextRoundSlot,
  resetR32Bracket,
  resetKOBracket,
  NEXT_ROUND_SLOT,
} from "@/lib/ko-seeding";
import { calculatePoints, type Round } from "@/lib/points";
import { resetNotification } from "@/lib/notifications";

const PRESET_HOME = 2;
const PRESET_AWAY = 0;

function gate() {
  if (process.env.E2E_TEST !== "true") return new NextResponse(null, { status: 404 });
  return null;
}

/**
 * GET: return expected group standings (team IDs) given preset home-wins-all results.
 * Response: { groups: { [A-L]: { expectedStandings: string[] } }, totalGoals: number }
 */
export async function GET(_req: Request) {
  const g = gate(); if (g) return g;

  const groupMatches = await db.match.findMany({
    where: { round: "Group" },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { matchNumber: "asc" },
  });

  const matchInputs = groupMatches.map((m) => ({
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    group: m.group,
    homeScore: PRESET_HOME,
    awayScore: PRESET_AWAY,
  }));

  const standings = computeStandings(matchInputs);

  const groups: Record<string, { expectedStandings: string[] }> = {};
  for (const [group, orderedIds] of standings.entries()) {
    groups[group] = { expectedStandings: orderedIds };
  }

  return NextResponse.json({ groups, totalGoals: groupMatches.length * PRESET_HOME });
}

/**
 * POST: run preset simulation for a room.
 * Body: { roomId: string, phase: 1 | 2 }
 * Phase 1: group stage → sets room to ko_betting
 * Phase 2: KO stage   → sets room to ko_active
 */
export async function POST(req: NextRequest) {
  const g = gate(); if (g) return g;

  let body: { roomId?: string; phase?: number };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { roomId, phase } = body;
  if (!roomId) return NextResponse.json({ error: "roomId required" }, { status: 400 });
  if (phase !== 1 && phase !== 2) return NextResponse.json({ error: "phase must be 1 or 2" }, { status: 400 });

  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  try {
    if (phase === 1) {
      await runPresetGroupStage(roomId, room.entryFee);
    } else {
      await runPresetKOStage(roomId, room.entryFee);
    }
    return NextResponse.json({ ok: true, phase });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Simulation failed" },
      { status: 500 }
    );
  }
}

/**
 * DELETE: reset tournament state for a room (undo the simulation).
 * Body: { roomId: string }
 */
export async function DELETE(req: NextRequest) {
  const g = gate(); if (g) return g;

  let body: { roomId?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { roomId } = body;
  if (!roomId) return NextResponse.json({ error: "roomId required" }, { status: 400 });

  await db.match.updateMany({
    where: { status: "finished" },
    data: { homeScore: null, awayScore: null, status: "scheduled" },
  });
  await resetR32Bracket();
  await resetKOBracket();
  await resetNotification("Group").catch(() => {});

  await db.prediction.updateMany({ where: { roomId }, data: { points: null, earnedAmount: null } });
  await db.groupStandingPrediction.updateMany({ where: { roomId }, data: { earnedAmount: null } });

  await db.room.update({
    where: { id: roomId },
    data: { status: "betting", simulationMode: false },
  });

  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Phase 1: preset group stage
// ---------------------------------------------------------------------------

async function runPresetGroupStage(roomId: string, entryFee: number) {
  const memberCount = await db.roomMember.count({ where: { roomId } });

  const groupMatches = await db.match.findMany({
    where: { round: "Group" },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { matchNumber: "asc" },
  });
  if (groupMatches.length === 0) throw new Error("No group matches found — run db:seed first");

  for (const match of groupMatches) {
    await db.match.update({
      where: { id: match.id },
      data: { homeScore: PRESET_HOME, awayScore: PRESET_AWAY, status: "finished" },
    });
  }

  const allRoomMemberIds = (
    await db.roomMember.findMany({ where: { roomId }, select: { userId: true } })
  ).map((m) => m.userId);

  const allPreds = await db.prediction.findMany({
    where: {
      userId: { in: allRoomMemberIds },
      match: { round: "Group" },
      OR: [{ roomId }, { roomId: null }],
    },
    include: { match: true },
  });

  await Promise.all(
    allPreds
      .filter((p) => p.match.homeScore !== null)
      .map((pred) => {
        const pts = calculatePoints(
          "Group",
          pred.homeScore,
          pred.awayScore,
          pred.match.homeScore!,
          pred.match.awayScore!
        );
        return db.prediction.update({ where: { id: pred.id }, data: { points: pts } });
      })
  );

  const matchInputs = groupMatches.map((m) => ({
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    group: m.group,
    homeScore: PRESET_HOME,
    awayScore: PRESET_AWAY,
  }));

  const actualStandings = computeStandings(matchInputs);
  const koStandings = buildStandingsFromMatches(matchInputs);
  await populateR32Bracket(koStandings);

  const pot = calculatePot(entryFee, memberCount);
  const prizePerGroup = pot.groupStagePot / 12;

  for (const [group, actual] of actualStandings.entries()) {
    const a4 = actual.slice(0, 4) as [string, string, string, string];

    const allGroupPreds = await db.groupStandingPrediction.findMany({
      where: { roomId, wcGroup: group },
    });

    const allScored = allGroupPreds.map((gp) => ({
      id: gp.id,
      predicted: [gp.position1, gp.position2, gp.position3, gp.position4] as [string, string, string, string],
      multiplier: scoreGroupStanding(
        [gp.position1, gp.position2, gp.position3, gp.position4] as [string, string, string, string],
        a4
      ).scoreMultiplier,
    }));

    const byMultiplier = new Map<number, number>();
    for (const s of allScored) {
      byMultiplier.set(s.multiplier, (byMultiplier.get(s.multiplier) ?? 0) + 1);
    }

    for (const s of allScored) {
      const winnersCount = byMultiplier.get(s.multiplier) ?? 1;
      const earnedAmount = earnedFromGroupStanding(
        s.predicted,
        a4,
        prizePerGroup,
        s.multiplier > 0 ? winnersCount : 0
      );
      await db.groupStandingPrediction.update({ where: { id: s.id }, data: { earnedAmount } });
    }
  }

  await db.room.update({
    where: { id: roomId },
    data: { status: "ko_betting", simulationMode: true },
  });
}

// ---------------------------------------------------------------------------
// Phase 2: preset KO stage
// ---------------------------------------------------------------------------

async function runPresetKOStage(roomId: string, entryFee: number) {
  const memberCount = await db.roomMember.count({ where: { roomId } });
  const pot = calculatePot(entryFee, memberCount);

  const koMatches = await db.match.findMany({
    where: { round: { in: [...KO_ROUNDS] } },
    orderBy: { matchNumber: "asc" },
  });
  if (koMatches.length === 0) return;

  const teamSlots = new Map<number, { homeTeamId: string | null; awayTeamId: string | null }>();
  for (const m of koMatches) {
    teamSlots.set(m.matchNumber, { homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId });
  }

  for (const match of koMatches) {
    await db.match.update({
      where: { id: match.id },
      data: { homeScore: PRESET_HOME, awayScore: PRESET_AWAY, status: "finished" },
    });

    const slots = teamSlots.get(match.matchNumber)!;
    const winnerId = slots.homeTeamId;
    const loserId = slots.awayTeamId;

    if (winnerId) {
      const nextSlot = NEXT_ROUND_SLOT[match.matchNumber];
      if (nextSlot) {
        const nextSlots = teamSlots.get(nextSlot.winner.matchNumber);
        if (nextSlots) {
          if (nextSlot.winner.side === "home") nextSlots.homeTeamId = winnerId;
          else nextSlots.awayTeamId = winnerId;
        }
        if (nextSlot.loser && loserId) {
          const loserSlots = teamSlots.get(nextSlot.loser.matchNumber);
          if (loserSlots) {
            if (nextSlot.loser.side === "home") loserSlots.homeTeamId = loserId;
            else loserSlots.awayTeamId = loserId;
          }
        }
        await populateNextRoundSlot(match.matchNumber, winnerId, loserId);
      }
    }

    const matchPrize = pot.prizePerKOMatch[match.round as KORound] ?? 0;
    const allMatchPreds = await db.prediction.findMany({ where: { matchId: match.id, roomId } });

    const scored = allMatchPreds.map((pred) => {
      const scoreMultiplier = (() => {
        if (pred.homeScore === PRESET_HOME && pred.awayScore === PRESET_AWAY) return 1.0;
        const pWin = pred.homeScore > pred.awayScore ? "home" : pred.homeScore < pred.awayScore ? "away" : "draw";
        return pWin === "home" ? 0.75 : 0;
      })();
      const pts = calculatePoints(match.round as Round, pred.homeScore, pred.awayScore, PRESET_HOME, PRESET_AWAY);
      return { id: pred.id, homeScore: pred.homeScore, awayScore: pred.awayScore, scoreMultiplier, pts };
    });

    const byMultiplier = new Map<number, number>();
    for (const s of scored) {
      if (s.scoreMultiplier > 0) byMultiplier.set(s.scoreMultiplier, (byMultiplier.get(s.scoreMultiplier) ?? 0) + 1);
    }

    await Promise.all(
      scored.map((s) => {
        const winnersCount = byMultiplier.get(s.scoreMultiplier) ?? 0;
        const earnedAmount = earnedFromKOMatch(
          s.homeScore, s.awayScore, PRESET_HOME, PRESET_AWAY, matchPrize, winnersCount
        );
        return db.prediction.update({ where: { id: s.id }, data: { points: s.pts, earnedAmount } });
      })
    );
  }

  await db.room.update({ where: { id: roomId }, data: { status: "ko_active" } });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeStandings(
  matches: {
    homeTeamId: string | null;
    awayTeamId: string | null;
    group: string | null;
    homeScore: number;
    awayScore: number;
  }[]
): Map<string, string[]> {
  const standings = new Map<string, Map<string, { pts: number; gd: number; gf: number }>>();

  for (const m of matches) {
    if (!m.homeTeamId || !m.awayTeamId || !m.group) continue;
    if (!standings.has(m.group)) standings.set(m.group, new Map());
    const g = standings.get(m.group)!;
    if (!g.has(m.homeTeamId)) g.set(m.homeTeamId, { pts: 0, gd: 0, gf: 0 });
    if (!g.has(m.awayTeamId)) g.set(m.awayTeamId, { pts: 0, gd: 0, gf: 0 });

    const home = g.get(m.homeTeamId)!;
    const away = g.get(m.awayTeamId)!;
    const gd = m.homeScore - m.awayScore;
    home.gf += m.homeScore; away.gf += m.awayScore;
    home.gd += gd; away.gd -= gd;
    if (m.homeScore > m.awayScore) home.pts += 3;
    else if (m.homeScore < m.awayScore) away.pts += 3;
    else { home.pts += 1; away.pts += 1; }
  }

  const result = new Map<string, string[]>();
  for (const [group, teamMap] of standings.entries()) {
    const sorted = [...teamMap.entries()]
      .sort((a, b) => b[1].pts - a[1].pts || b[1].gd - a[1].gd || b[1].gf - a[1].gf)
      .map(([id]) => id);
    result.set(group, sorted);
  }
  return result;
}
