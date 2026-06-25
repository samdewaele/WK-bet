import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { computeUberPotResults } from "@/lib/uber-pot";
import { requireRoomAccess } from "@/lib/room-auth";
import { calculatePot, KO_MATCH_WEIGHT, type KORound } from "@/lib/pot";

const WC_GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

// When the room reaches these statuses ALL group predictions are revealed at once.
const STANDINGS_VISIBLE = ["group_active", "ko_betting", "ko_active", "settling", "finished"];
// KO predictions stay hidden until the knockout bracket locks (first KO kickoff).
const KO_VISIBLE = ["ko_active", "settling", "finished"];

/**
 * GET /api/groups/[roomId]/predictions-overview
 *
 * Cross-member view of everyone's predictions + winnings:
 *   - group standings: revealed per-group when that group's first match kicks off
 *                      (or all at once if room is group_active or later)
 *   - KO predictions:  revealed from ko_active onwards
 *   - Uber Pot bets:   everyone's answers, revealed once any group has started;
 *                      winner + money shown once the admin settles each bet.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const access = await requireRoomAccess(roomId);
  if (access instanceof NextResponse) return access;

  const room = await db.room.findUnique({
    where: { id: roomId },
    include: { members: { select: { userId: true, excludedFromPot: true } } },
  });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const revealAll = STANDINGS_VISIBLE.includes(room.status);
  const revealKO = KO_VISIBLE.includes(room.status);

  // Fetch first kickoff per group to determine per-group reveal state
  const firstKickoffs = await db.match.findMany({
    where: { round: "Group", group: { not: null } },
    select: { group: true, kickoff: true },
    orderBy: { kickoff: "asc" },
  });
  const kickoffMap = new Map<string, Date>();
  for (const m of firstKickoffs) {
    if (m.group && !kickoffMap.has(m.group)) kickoffMap.set(m.group, m.kickoff);
  }

  const now = new Date();
  const groupVisibility: Record<string, { revealed: boolean; kickoff: string | null }> = {};
  for (const g of WC_GROUPS) {
    const kickoff = kickoffMap.get(g) ?? null;
    const revealed = revealAll || (kickoff ? now >= kickoff : false);
    groupVisibility[g] = { revealed, kickoff: kickoff?.toISOString() ?? null };
  }

  const anyRevealed = Object.values(groupVisibility).some((v) => v.revealed);
  if (!anyRevealed) {
    return NextResponse.json({ error: "Predictions are revealed once the group stage starts" }, { status: 403 });
  }

  const revealedGroups = new Set(
    Object.entries(groupVisibility).filter(([, v]) => v.revealed).map(([g]) => g),
  );

  const activeMemberCount = room.members.filter((m) => !m.excludedFromPot).length;
  const pot = calculatePot(room.entryFee, activeMemberCount);
  const excludedIds = room.members.filter((m) => m.excludedFromPot).map((m) => m.userId);
  const excludeFilter = excludedIds.length > 0 ? { userId: { notIn: excludedIds } } : {};

  const [members, groupStandings, koPredictions, teams, sideBets, uber, groupByWcGroup, koByMatch] = await Promise.all([
    db.roomMember.findMany({
      where: { roomId },
      include: { user: { select: { id: true, name: true, image: true } } },
    }),
    db.groupStandingPrediction.findMany({
      where: { roomId, wcGroup: { in: [...revealedGroups] } },
      orderBy: { wcGroup: "asc" },
    }),
    revealKO
      ? db.kOPrediction.findMany({
          where: { roomId },
          include: {
            match: {
              select: {
                round: true,
                matchNumber: true,
                kickoff: true,
                status: true,
                homeScore: true,
                awayScore: true,
                homeTeam: { select: { id: true, name: true, flag: true } },
                awayTeam: { select: { id: true, name: true, flag: true } },
              },
            },
          },
          orderBy: { match: { kickoff: "asc" } },
        })
      : Promise.resolve([] as never[]),
    db.team.findMany({ select: { id: true, name: true, flag: true } }),
    db.sideBet.findMany({
      where: { roomId },
      include: {
        entries: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "asc" },
    }),
    computeUberPotResults(roomId),
    db.groupStandingPrediction.groupBy({
      by: ["wcGroup"],
      where: { roomId, earnedAmount: { not: null }, ...excludeFilter },
      _sum: { earnedAmount: true },
    }),
    revealKO
      ? db.kOPrediction.groupBy({
          by: ["matchId"],
          where: { roomId, earnedAmount: { not: null }, ...excludeFilter },
          _sum: { earnedAmount: true },
        })
      : Promise.resolve([] as { matchId: string; _sum: { earnedAmount: number | null } }[]),
  ]);

  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const resolve = (id: string) => teamMap.get(id) ?? { id, name: "?", flag: "" };

  // Per-group Uber Pot: how much of that group's prize went unclaimed
  const groupUberPot: Record<string, number> = {};
  for (const g of groupByWcGroup) {
    groupUberPot[g.wcGroup] = Math.max(0, pot.prizePerWCGroup - (g._sum.earnedAmount ?? 0));
  }

  // Per-match Uber Pot: how much of that match's prize went unclaimed
  const matchRoundMap = new Map<string, KORound>(
    koPredictions.map((p) => [p.matchId, p.match.round as KORound]),
  );
  const koMatchUberPot: Record<string, number> = {};
  for (const m of koByMatch) {
    const round = matchRoundMap.get(m.matchId);
    if (!round) continue;
    const matchPrize = pot.koUnit * (KO_MATCH_WEIGHT[round] ?? 0);
    koMatchUberPot[m.matchId] = Math.max(0, matchPrize - (m._sum.earnedAmount ?? 0));
  }

  // Simulation rooms keep fake KO results and bracket teams in SimResult —
  // overlay them so the shared KO picks view shows the simulated tournament.
  const simOverlay = new Map<
    string,
    { homeTeamId: string | null; awayTeamId: string | null; homeScore: number | null; awayScore: number | null }
  >();
  if (room.simulationMode && revealKO && koPredictions.length > 0) {
    const matchIds = [...new Set(koPredictions.map((p) => p.matchId))];
    const sims = await db.simResult.findMany({ where: { matchId: { in: matchIds } } });
    for (const s of sims) simOverlay.set(s.matchId, s);
  }
  const overlayMatch = (matchId: string, match: (typeof koPredictions)[number]["match"]) => {
    const sim = simOverlay.get(matchId);
    if (!sim) {
      return {
        kickoff: match.kickoff.toISOString(),
        status: match.status,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        homeScore: match.homeScore,
        awayScore: match.awayScore,
      };
    }
    const simFinished = sim.homeScore !== null && sim.awayScore !== null;
    return {
      kickoff: match.kickoff.toISOString(),
      status: simFinished ? "finished" : match.status,
      homeTeam: sim.homeTeamId ? resolve(sim.homeTeamId) : match.homeTeam,
      awayTeam: sim.awayTeamId ? resolve(sim.awayTeamId) : match.awayTeam,
      homeScore: sim.homeScore ?? match.homeScore,
      awayScore: sim.awayScore ?? match.awayScore,
    };
  };

  const standingsByUser = new Map<string, typeof groupStandings>();
  for (const g of groupStandings) {
    const list = standingsByUser.get(g.userId) ?? [];
    list.push(g);
    standingsByUser.set(g.userId, list);
  }

  const koByUser = new Map<string, typeof koPredictions>();
  for (const p of koPredictions) {
    const list = koByUser.get(p.userId) ?? [];
    list.push(p);
    koByUser.set(p.userId, list);
  }

  return NextResponse.json({
    revealKO,
    groupVisibility,
    groupUberPot,
    koMatchUberPot,
    members: members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      image: m.user.image,
      standings: (standingsByUser.get(m.userId) ?? []).map((g) => ({
        wcGroup: g.wcGroup,
        positions: [g.position1, g.position2, g.position3, g.position4].map(resolve),
        earnedAmount: g.earnedAmount,
      })),
      knockout: revealKO
        ? (koByUser.get(m.userId) ?? []).map((p) => ({
            matchId: p.matchId,
            round: p.match.round,
            matchNumber: p.match.matchNumber,
            homeScore: p.homeScore,
            awayScore: p.awayScore,
            earnedAmount: p.earnedAmount,
            match: overlayMatch(p.matchId, p.match),
          }))
        : null,
    })),
    uberPot: {
      total: uber.accumulatedUberPot,
      prizePerSettledBet: uber.prizePerSettledBet,
      bets: sideBets
        .filter((sb) => sb.status !== "proposed")
        .map((sb) => {
          const result = uber.byBet.get(sb.id);
          return {
            id: sb.id,
            title: sb.title,
            description: sb.description,
            status: sb.status,
            winnerEntryId: sb.winnerEntryId,
            winnerUserId: result?.winnerUserId ?? null,
            prize: sb.status === "settled" ? (result?.prize ?? 0) : null,
            entries: sb.entries.map((e) => ({
              entryId: e.id,
              userId: e.userId,
              userName: e.user.name,
              answer: e.answer,
            })),
          };
        }),
    },
  });
}
