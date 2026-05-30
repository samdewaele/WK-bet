import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { roomId } = await params;

  const membership = await db.roomMember.findUnique({
    where: { userId_roomId: { userId: session.user.id, roomId } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const KO_ROUNDS = ["R32", "R16", "QF", "SF", "3rd", "Final"];
  const KO_VISIBLE_STATUSES = ["ko_betting", "ko_active", "finished"];

  const room = await db.room.findUnique({ where: { id: roomId }, select: { status: true } });

  // Only show KO matches once the group stage is complete and KO betting is open
  if (!room || !KO_VISIBLE_STATUSES.includes(room.status)) {
    return NextResponse.json([]);
  }

  const [koMatches, existingPredictions] = await Promise.all([
    db.match.findMany({
      where: { round: { in: KO_ROUNDS } },
      include: {
        homeTeam: { select: { id: true, name: true, flag: true } },
        awayTeam: { select: { id: true, name: true, flag: true } },
      },
      orderBy: { kickoff: "asc" },
    }),
    db.prediction.findMany({
      where: { userId: session.user.id, roomId, match: { round: { in: KO_ROUNDS } } },
      select: { matchId: true, homeScore: true, awayScore: true, earnedAmount: true },
    }),
  ]);

  const predMap = new Map(existingPredictions.map((p) => [p.matchId, p]));

  return NextResponse.json(
    koMatches.map((m) => {
      const pred = predMap.get(m.id);
      return {
        id: m.id,
        matchId: m.id,
        homeScore: pred?.homeScore ?? 0,
        awayScore: pred?.awayScore ?? 0,
        earnedAmount: pred?.earnedAmount ?? null,
        predicted: !!pred,
        match: {
          id: m.id,
          round: m.round,
          group: m.group,
          matchNumber: m.matchNumber,
          kickoff: m.kickoff.toISOString(),
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          status: m.status,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
        },
      };
    })
  );
}

type KOPredictionInput = {
  matchId: string;
  homeScore: number;
  awayScore: number;
};

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

  const room = await db.room.findUnique({ where: { id: roomId }, select: { status: true } });
  if (room?.status !== "ko_betting") {
    return NextResponse.json({ error: "KO predictions are not open for this group" }, { status: 403 });
  }

  let body: { predictions: KOPredictionInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { predictions } = body;
  if (!Array.isArray(predictions) || predictions.length === 0) {
    return NextResponse.json({ error: "No predictions provided" }, { status: 400 });
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
      db.prediction.upsert({
        where: { userId_matchId_roomId: { userId, matchId: pred.matchId, roomId } },
        create: {
          userId,
          matchId: pred.matchId,
          roomId,
          homeScore: pred.homeScore,
          awayScore: pred.awayScore,
        },
        update: {
          homeScore: pred.homeScore,
          awayScore: pred.awayScore,
          earnedAmount: null,
        },
      })
    )
  );

  return NextResponse.json({ saved: upserted.length });
}
