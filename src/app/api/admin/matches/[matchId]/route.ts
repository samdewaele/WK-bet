import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { calculatePoints, type Round } from "@/lib/points";

const KO_ROUNDS = ["R32", "R16", "QF", "SF", "3rd", "Final"];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { matchId } = await params;

  let body: { homeScore?: number | null; awayScore?: number | null; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { homeScore, awayScore, status } = body;
  const validStatuses = ["scheduled", "live", "finished"];
  if (status && !validStatuses.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const match = await db.match.update({
    where: { id: matchId },
    data: {
      ...(homeScore !== undefined && { homeScore }),
      ...(awayScore !== undefined && { awayScore }),
      ...(status !== undefined && { status }),
    },
    include: {
      predictions: true,
      koPredictions: true,
    },
  });

  // Recalculate points for all predictions if match is finished with scores
  if (match.status === "finished" && match.homeScore !== null && match.awayScore !== null) {
    const round = match.round as Round;
    if (KO_ROUNDS.includes(round)) {
      await Promise.all(
        match.koPredictions.map((pred) => {
          const points = calculatePoints(round, pred.homeScore, pred.awayScore, match.homeScore!, match.awayScore!);
          return db.kOPrediction.update({ where: { id: pred.id }, data: { points } });
        })
      );
    } else {
      await Promise.all(
        match.predictions.map((pred) => {
          const points = calculatePoints(round, pred.homeScore, pred.awayScore, match.homeScore!, match.awayScore!);
          return db.prediction.update({ where: { id: pred.id }, data: { points } });
        })
      );
    }
  }

  return NextResponse.json({
    id: match.id,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    status: match.status,
    predictionsUpdated: match.status === "finished"
      ? (KO_ROUNDS.includes(match.round) ? match.koPredictions.length : match.predictions.length)
      : 0,
  });
}
