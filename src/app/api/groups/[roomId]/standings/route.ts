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

  const predictions = await db.groupStandingPrediction.findMany({
    where: { userId: session.user.id, roomId },
  });

  return NextResponse.json(
    predictions.map((p) => ({
      id: p.id,
      wcGroup: p.wcGroup,
      position1: p.position1,
      position2: p.position2,
      position3: p.position3,
      position4: p.position4,
      earnedAmount: p.earnedAmount,
    }))
  );
}

type StandingInput = {
  wcGroup: string;
  position1: string;
  position2: string;
  position3: string;
  position4: string;
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
  const STANDINGS_LOCKED = ["closed", "group_active", "ko_betting", "ko_active", "finished"];
  if (room && STANDINGS_LOCKED.includes(room.status)) {
    return NextResponse.json({ error: "Group stage predictions are locked" }, { status: 403 });
  }

  let body: { predictions: StandingInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { predictions } = body;
  if (!Array.isArray(predictions) || predictions.length === 0) {
    return NextResponse.json({ error: "No predictions provided" }, { status: 400 });
  }

  const valid: StandingInput[] = [];
  const errors: string[] = [];

  for (const pred of predictions) {
    const { wcGroup, position1, position2, position3, position4 } = pred;
    if (!wcGroup || !position1 || !position2 || !position3 || !position4) {
      errors.push(`Group ${wcGroup}: all 4 positions required`);
      continue;
    }

    const positions = [position1, position2, position3, position4];
    const unique = new Set(positions);
    if (unique.size !== 4) {
      errors.push(`Group ${wcGroup}: all 4 teams must be different`);
      continue;
    }

    // Verify teams belong to this WC group
    const teams = await db.team.findMany({
      where: { id: { in: positions }, group: wcGroup },
    });
    if (teams.length !== 4) {
      errors.push(`Group ${wcGroup}: invalid team selection`);
      continue;
    }

    valid.push(pred);
  }

  if (valid.length === 0) {
    return NextResponse.json({ error: "No valid predictions", details: errors }, { status: 400 });
  }

  const upserted = await Promise.all(
    valid.map((pred) =>
      db.groupStandingPrediction.upsert({
        where: { userId_roomId_wcGroup: { userId, roomId, wcGroup: pred.wcGroup } },
        create: {
          userId,
          roomId,
          wcGroup: pred.wcGroup,
          position1: pred.position1,
          position2: pred.position2,
          position3: pred.position3,
          position4: pred.position4,
        },
        update: {
          position1: pred.position1,
          position2: pred.position2,
          position3: pred.position3,
          position4: pred.position4,
          earnedAmount: null,
        },
      })
    )
  );

  return NextResponse.json({ saved: upserted.length, errors });
}
