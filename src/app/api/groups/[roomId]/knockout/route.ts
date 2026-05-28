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

  const predictions = await db.prediction.findMany({
    where: { userId: session.user.id, roomId },
    include: {
      match: {
        include: {
          homeTeam: { select: { id: true, name: true, flag: true } },
          awayTeam: { select: { id: true, name: true, flag: true } },
        },
      },
    },
    orderBy: { match: { kickoff: "asc" } },
  });

  return NextResponse.json(
    predictions.map((p) => ({
      id: p.id,
      matchId: p.matchId,
      homeScore: p.homeScore,
      awayScore: p.awayScore,
      earnedAmount: p.earnedAmount,
      match: {
        id: p.match.id,
        round: p.match.round,
        group: p.match.group,
        matchNumber: p.match.matchNumber,
        kickoff: p.match.kickoff.toISOString(),
        homeScore: p.match.homeScore,
        awayScore: p.match.awayScore,
        status: p.match.status,
        homeTeam: p.match.homeTeam,
        awayTeam: p.match.awayTeam,
      },
    }))
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
  if (room && ["locked", "active", "finished"].includes(room.status)) {
    return NextResponse.json({ error: "Predictions are locked for this group" }, { status: 403 });
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
