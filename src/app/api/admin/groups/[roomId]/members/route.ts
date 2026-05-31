import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";

type Params = { params: Promise<{ roomId: string }> };

async function resolveAccess(roomId: string, userId: string, role: string) {
  const room = await db.room.findUnique({ where: { id: roomId }, select: { creatorId: true } });
  if (!room) return null;
  if (room.creatorId !== userId && role !== "admin") return null;
  return room;
}

export async function GET(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId } = await params;
  if (!await resolveAccess(roomId, session.user.id, session.user.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const members = await db.roomMember.findMany({
    where: { roomId },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  const totalGroupMatches = await db.match.count({ where: { round: "Group" } });
  const totalKOMatches = await db.match.count({ where: { round: { not: "Group" } } });

  const stats = await Promise.all(
    members.map(async (m) => {
      // Group predictions are stored globally (roomId: null) via /api/predictions
      const groupPredictions = await db.prediction.count({
        where: { userId: m.userId, roomId: null, match: { round: "Group" } },
      });
      // Group predictions: stored with roomId=null. KO predictions: stored with roomId=<id>.
      // Filtering by roomId alone is sufficient — no need for a match-relation join.
      const koPredictions = await db.prediction.count({
        where: { userId: m.userId, roomId },
      });
      const groupStandingGroups = await db.groupStandingPrediction.count({
        where: { userId: m.userId, roomId },
      });
      return {
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        paid: m.paid,
        excludedFromPot: m.excludedFromPot,
        groupPredictions,
        totalGroupMatches,
        koPredictions,
        totalKOMatches,
        groupStandingGroups,
        totalGroupStandingGroups: 12,
      };
    })
  );

  return NextResponse.json(stats);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId } = await params;
  if (!await resolveAccess(roomId, session.user.id, session.user.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { userId: string; excludedFromPot?: boolean; paid?: boolean };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const member = await db.roomMember.findUnique({
    where: { userId_roomId: { userId: body.userId, roomId } },
  });
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (typeof body.excludedFromPot === "boolean") data.excludedFromPot = body.excludedFromPot;
  if (typeof body.paid === "boolean") data.paid = body.paid;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  await db.roomMember.update({
    where: { userId_roomId: { userId: body.userId, roomId } },
    data,
  });

  return NextResponse.json({ ok: true });
}
