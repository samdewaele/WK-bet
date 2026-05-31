import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";

// GET — return the current user's rooms
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
        },
      },
    },
  });

  const rooms = memberships.map((m) => ({
    id: m.room.id,
    name: m.room.name,
    inviteCode: m.room.inviteCode,
    memberCount: m.room.members.length,
    createdAt: m.room.createdAt.toISOString(),
  }));

  return NextResponse.json(rooms);
}

// POST — create a new room
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
      { error: "Room name must be between 1 and 50 characters" },
      { status: 400 }
    );
  }

  const userId = session.user.id;

  // Create room and add creator as member in a transaction
  const room = await db.$transaction(async (tx) => {
    const data: Record<string, unknown> = { name, creatorId: userId };
    if (typeof body.entryFee === "number" && body.entryFee >= 0) data.entryFee = body.entryFee;
    const newRoom = await tx.room.create({ data });
    await tx.roomMember.create({
      data: { userId, roomId: newRoom.id },
    });
    return newRoom;
  });

  return NextResponse.json({
    id: room.id,
    name: room.name,
    inviteCode: room.inviteCode,
    memberCount: 1,
    createdAt: room.createdAt.toISOString(),
  });
}

// PUT — join a room by invite code
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
    include: { members: true },
  });

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const userId = session.user.id;
  const alreadyMember = room.members.some((m) => m.userId === userId);
  if (!alreadyMember) {
    await db.roomMember.create({
      data: { userId, roomId: room.id },
    });
  }

  return NextResponse.json({
    id: room.id,
    name: room.name,
    inviteCode: room.inviteCode,
    memberCount: alreadyMember ? room.members.length : room.members.length + 1,
    createdAt: room.createdAt.toISOString(),
  });
}
