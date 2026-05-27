import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const memberships = await db.roomMember.findMany({
    where: { userId: session.user.id },
    include: {
      room: {
        include: {
          members: true,
          sideBets: true,
        },
      },
    },
  });

  const groups = memberships.map((m) => ({
    id: m.room.id,
    name: m.room.name,
    inviteCode: m.room.inviteCode,
    entryFee: m.room.entryFee,
    status: m.room.status,
    memberCount: m.room.members.length,
    sideBetCount: m.room.sideBets.length,
    createdAt: m.room.createdAt.toISOString(),
  }));

  return NextResponse.json(groups);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { name?: string; entryFee?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name || name.length < 1 || name.length > 50) {
    return NextResponse.json(
      { error: "Group name must be between 1 and 50 characters" },
      { status: 400 }
    );
  }

  const entryFee = typeof body.entryFee === "number" ? body.entryFee : 0;
  if (entryFee < 0) {
    return NextResponse.json({ error: "Entry fee cannot be negative" }, { status: 400 });
  }

  const userId = session.user.id;

  const room = await db.$transaction(async (tx) => {
    const newRoom = await tx.room.create({
      data: { name, entryFee, creatorId: userId, status: "setup" },
    });
    await tx.roomMember.create({
      data: { userId, roomId: newRoom.id },
    });
    return newRoom;
  });

  return NextResponse.json({
    id: room.id,
    name: room.name,
    inviteCode: room.inviteCode,
    entryFee: room.entryFee,
    status: room.status,
    memberCount: 1,
    sideBetCount: 0,
    createdAt: room.createdAt.toISOString(),
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { inviteCode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const inviteCode = body.inviteCode?.trim();
  if (!inviteCode) {
    return NextResponse.json({ error: "Invite code is required" }, { status: 400 });
  }

  const room = await db.room.findUnique({
    where: { inviteCode },
    include: { members: true, sideBets: true },
  });

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const userId = session.user.id;
  const alreadyMember = room.members.some((m) => m.userId === userId);
  if (!alreadyMember) {
    await db.roomMember.create({ data: { userId, roomId: room.id } });
  }

  return NextResponse.json({
    id: room.id,
    name: room.name,
    inviteCode: room.inviteCode,
    entryFee: room.entryFee,
    status: room.status,
    memberCount: alreadyMember ? room.members.length : room.members.length + 1,
    sideBetCount: room.sideBets.length,
    createdAt: room.createdAt.toISOString(),
  });
}
