import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const predictions = await db.prediction.findMany({
    where: { userId: session.user.id },
    include: {
      match: {
        select: {
          id: true,
          round: true,
          group: true,
          matchNumber: true,
          kickoff: true,
          homeScore: true,
          awayScore: true,
          status: true,
        },
      },
    },
    orderBy: { match: { kickoff: "asc" } },
  });

  return NextResponse.json(
    predictions.map((p) => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      match: {
        ...p.match,
        kickoff: p.match.kickoff.toISOString(),
      },
    }))
  );
}

type PredictionInput = {
  matchId: string;
  homeScore: number;
  awayScore: number;
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  let body: { predictions: PredictionInput[] };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { predictions } = body;
  if (!Array.isArray(predictions) || predictions.length === 0) {
    return NextResponse.json({ error: "No predictions provided" }, { status: 400 });
  }

  // Validate each prediction and ensure match exists + is not locked
  const matchIds = predictions.map((p) => p.matchId);
  const matches = await db.match.findMany({
    where: { id: { in: matchIds } },
    select: { id: true, kickoff: true, status: true },
  });

  const matchMap = new Map(matches.map((m) => [m.id, m]));

  const valid: PredictionInput[] = [];
  for (const pred of predictions) {
    const match = matchMap.get(pred.matchId);
    if (!match) continue;
    if (match.status === "live" || match.status === "finished") continue;
    if (new Date(match.kickoff) <= new Date()) continue;
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

  // Upsert all valid predictions
  const upserted = await Promise.all(
    valid.map((pred) =>
      db.prediction.upsert({
        where: {
          userId_matchId: {
            userId,
            matchId: pred.matchId,
          },
        },
        create: {
          userId,
          matchId: pred.matchId,
          homeScore: pred.homeScore,
          awayScore: pred.awayScore,
        },
        update: {
          homeScore: pred.homeScore,
          awayScore: pred.awayScore,
          // Clear old points when prediction is updated
          points: null,
        },
      })
    )
  );

  return NextResponse.json({
    saved: upserted.length,
    predictions: upserted.map((p) => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
  });
}
