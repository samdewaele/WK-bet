import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { requireRoomAccess } from "@/lib/room-auth";
import { calculatePot, KO_MATCH_WEIGHT, type KORound } from "@/lib/pot";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const access = await requireRoomAccess(roomId);
  if (access instanceof NextResponse) return access;
  const session = access.session;

  const KO_ROUNDS = ["R32", "R16", "QF", "SF", "3rd", "Final"];
  const KO_VISIBLE_STATUSES = ["ko_betting", "ko_active", "settling", "finished"];

  const room = await db.room.findUnique({
    where: { id: roomId },
    include: { members: { select: { userId: true, excludedFromPot: true } } },
  });

  if (!room || !KO_VISIBLE_STATUSES.includes(room.status)) {
    return NextResponse.json([]);
  }

  // A room admin (creator or platform admin) may view another member's bracket
  // via ?userId= (used by the admin "edit a member's predictions" tool).
  const isAdmin = room.creatorId === session.user.id || access.isPlatformAdmin;
  const targetParam = new URL(req.url).searchParams.get("userId");
  const viewUserId = targetParam && isAdmin ? targetParam : session.user.id;

  const activeMemberCount = room.members.filter((m) => !m.excludedFromPot).length;
  const pot = calculatePot(room.entryFee, activeMemberCount);

  const excludedIds = room.members.filter((m) => m.excludedFromPot).map((m) => m.userId);
  const excludeFilter = excludedIds.length > 0 ? { userId: { notIn: excludedIds } } : {};

  const [koMatches, existingPredictions, koByMatchAgg] = await Promise.all([
    db.match.findMany({
      where: { round: { in: KO_ROUNDS } },
      include: {
        homeTeam: { select: { id: true, name: true, flag: true } },
        awayTeam: { select: { id: true, name: true, flag: true } },
      },
      orderBy: { kickoff: "asc" },
    }),
    db.kOPrediction.findMany({
      where: { userId: viewUserId, roomId },
      select: { matchId: true, homeScore: true, awayScore: true, penaltyWinner: true, earnedAmount: true },
    }),
    db.kOPrediction.groupBy({
      by: ["matchId"],
      where: { roomId, earnedAmount: { not: null }, ...excludeFilter },
      _sum: { earnedAmount: true },
    }),
  ]);

  const distributedByMatch = new Map(koByMatchAgg.map((m) => [m.matchId, m._sum.earnedAmount ?? 0]));

  // Simulation rooms keep fake results and bracket teams in SimResult —
  // overlay them so the bracket displays the simulated tournament.
  type TeamInfo = { id: string; name: string; flag: string } | null;
  const simOverlay = new Map<
    string,
    { homeTeam: TeamInfo; awayTeam: TeamInfo; homeScore: number | null; awayScore: number | null }
  >();
  if (room.simulationMode) {
    const sims = await db.simResult.findMany({
      where: { matchId: { in: koMatches.map((m) => m.id) } },
    });
    const teamIds = [
      ...new Set(sims.flatMap((s) => [s.homeTeamId, s.awayTeamId]).filter((id): id is string => !!id)),
    ];
    const teams = await db.team.findMany({
      where: { id: { in: teamIds } },
      select: { id: true, name: true, flag: true },
    });
    const teamMap = new Map(teams.map((t) => [t.id, t]));
    for (const s of sims) {
      simOverlay.set(s.matchId, {
        homeTeam: s.homeTeamId ? (teamMap.get(s.homeTeamId) ?? null) : null,
        awayTeam: s.awayTeamId ? (teamMap.get(s.awayTeamId) ?? null) : null,
        homeScore: s.homeScore,
        awayScore: s.awayScore,
      });
    }
  }

  const predMap = new Map(existingPredictions.map((p) => [p.matchId, p]));

  return NextResponse.json(
    koMatches.map((m) => {
      const pred = predMap.get(m.id);
      const sim = simOverlay.get(m.id);
      const simFinished = sim != null && sim.homeScore !== null && sim.awayScore !== null;
      const round = m.round as KORound;
      const matchPrize = pot.koUnit * (KO_MATCH_WEIGHT[round] ?? 0);
      const settled = distributedByMatch.has(m.id);
      return {
        id: m.id,
        matchId: m.id,
        homeScore: pred?.homeScore ?? 0,
        awayScore: pred?.awayScore ?? 0,
        penaltyWinner: pred?.penaltyWinner ?? null,
        earnedAmount: pred?.earnedAmount ?? null,
        predicted: !!pred,
        match: {
          id: m.id,
          round: m.round,
          group: m.group,
          matchNumber: m.matchNumber,
          kickoff: m.kickoff.toISOString(),
          homeScore: sim?.homeScore ?? m.homeScore,
          awayScore: sim?.awayScore ?? m.awayScore,
          penaltyHome: m.penaltyHome,
          penaltyAway: m.penaltyAway,
          status: simFinished ? "finished" : m.status,
          homeTeam: sim?.homeTeam ?? m.homeTeam,
          awayTeam: sim?.awayTeam ?? m.awayTeam,
          matchPrize,
          matchUberPot: settled ? Math.max(0, matchPrize - (distributedByMatch.get(m.id) ?? 0)) : null,
        },
      };
    })
  );
}

type KOPredictionInput = {
  matchId: string;
  homeScore: number;
  awayScore: number;
  penaltyWinner?: "home" | "away" | null;
};

type KOPostBody = { predictions: KOPredictionInput[]; targetUserId?: string };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { roomId } = await params;
  const userId = session.user.id;

  const membership = await db.roomMember.findUnique({
    where: { userId_roomId: { userId, roomId } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const room = await db.room.findUnique({ where: { id: roomId }, select: { status: true, creatorId: true } });

  let body: KOPostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { predictions } = body;
  if (!Array.isArray(predictions) || predictions.length === 0) {
    return NextResponse.json({ error: "No predictions provided" }, { status: 400 });
  }

  // Admin override: a room admin (creator or platform admin) may edit another
  // member's bracket via targetUserId — and that bypasses the room-level lock so
  // they can fix a member's picks after the KO window has closed. Per-match locks
  // (kickoff/live/finished) still apply, so already-started matches stay final.
  const isAdmin = room?.creatorId === userId || session.user.role === "admin";
  const isAdminOverride = !!body.targetUserId && isAdmin;
  const effectiveUserId = isAdminOverride ? body.targetUserId! : userId;

  if (!isAdminOverride && room?.status !== "ko_betting") {
    return NextResponse.json({ error: "KO predictions are not open for this group" }, { status: 403 });
  }
  if (isAdminOverride) {
    const targetMember = await db.roomMember.findUnique({
      where: { userId_roomId: { userId: effectiveUserId, roomId } },
    });
    if (!targetMember) {
      return NextResponse.json({ error: "Target user is not a member of this group" }, { status: 400 });
    }
  }

  const matchIds = predictions.map((p) => p.matchId);
  const matches = await db.match.findMany({
    where: { id: { in: matchIds } },
    select: { id: true, kickoff: true, status: true },
  });
  const matchMap = new Map(matches.map((m) => [m.id, m]));

  const valid: KOPredictionInput[] = [];
  for (const pred of predictions) {
    const match = matchMap.get(pred.matchId);
    if (!match) continue;
    if (new Date(match.kickoff) <= new Date()) continue;
    if (match.status === "live" || match.status === "finished") continue;
    if (
      typeof pred.homeScore !== "number" ||
      typeof pred.awayScore !== "number" ||
      pred.homeScore < 0 ||
      pred.awayScore < 0 ||
      pred.homeScore > 20 ||
      pred.awayScore > 20
    ) continue;
    if (pred.homeScore === pred.awayScore && pred.penaltyWinner !== "home" && pred.penaltyWinner !== "away") continue;
    valid.push(pred);
  }

  if (valid.length === 0) {
    return NextResponse.json(
      { error: "All predictions were for locked or invalid matches" },
      { status: 400 }
    );
  }

  const upserted = await Promise.all(
    valid.map((pred) =>
      db.kOPrediction.upsert({
        where: { userId_matchId_roomId: { userId: effectiveUserId, matchId: pred.matchId, roomId } },
        create: {
          userId: effectiveUserId,
          matchId: pred.matchId,
          roomId,
          homeScore: pred.homeScore,
          awayScore: pred.awayScore,
          penaltyWinner: pred.homeScore === pred.awayScore ? (pred.penaltyWinner ?? null) : null,
        },
        update: {
          homeScore: pred.homeScore,
          awayScore: pred.awayScore,
          penaltyWinner: pred.homeScore === pred.awayScore ? (pred.penaltyWinner ?? null) : null,
          earnedAmount: null,
        },
      })
    )
  );

  return NextResponse.json({ saved: upserted.length });
}
