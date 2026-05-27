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

  const sideBets = await db.sideBet.findMany({
    where: { roomId },
    include: {
      entries: {
        include: { user: { select: { id: true, name: true, image: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(
    sideBets.map((sb) => ({
      id: sb.id,
      title: sb.title,
      description: sb.description,
      status: sb.status,
      winnerEntryId: sb.winnerEntryId,
      createdAt: sb.createdAt.toISOString(),
      entries: sb.entries.map((e) => ({
        id: e.id,
        userId: e.userId,
        userName: e.user.name,
        userImage: e.user.image,
        answer: e.answer,
      })),
    }))
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { roomId } = await params;

  const membership = await db.roomMember.findUnique({
    where: { userId_roomId: { userId: session.user.id, roomId } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  let body: { title?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = body.title?.trim();
  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const sideBet = await db.sideBet.create({
    data: {
      roomId,
      title,
      description: body.description?.trim() ?? null,
      status: "open",
    },
  });

  return NextResponse.json({
    id: sideBet.id,
    title: sideBet.title,
    description: sideBet.description,
    status: sideBet.status,
    winnerEntryId: sideBet.winnerEntryId,
    createdAt: sideBet.createdAt.toISOString(),
    entries: [],
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { roomId } = await params;

  let body: { sideBetId?: string; winnerEntryId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.sideBetId || !body.winnerEntryId) {
    return NextResponse.json({ error: "sideBetId and winnerEntryId required" }, { status: 400 });
  }

  const sideBet = await db.sideBet.findFirst({
    where: { id: body.sideBetId, roomId },
  });
  if (!sideBet) {
    return NextResponse.json({ error: "Side bet not found" }, { status: 404 });
  }
  if (sideBet.status === "settled") {
    return NextResponse.json({ error: "Already settled" }, { status: 400 });
  }

  const entry = await db.sideBetEntry.findUnique({
    where: { id: body.winnerEntryId } as never,
  });
  if (!entry || (entry as { sideBetId: string }).sideBetId !== body.sideBetId) {
    return NextResponse.json({ error: "Winner entry not found" }, { status: 404 });
  }

  const updated = await db.sideBet.update({
    where: { id: body.sideBetId },
    data: { status: "settled", winnerEntryId: body.winnerEntryId },
  });

  return NextResponse.json({ id: updated.id, status: updated.status, winnerEntryId: updated.winnerEntryId });
}
