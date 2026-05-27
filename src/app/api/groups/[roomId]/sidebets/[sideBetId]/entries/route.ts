import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string; sideBetId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { roomId, sideBetId } = await params;
  const userId = session.user.id;

  const membership = await db.roomMember.findUnique({
    where: { userId_roomId: { userId, roomId } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const sideBet = await db.sideBet.findFirst({
    where: { id: sideBetId, roomId },
  });
  if (!sideBet) {
    return NextResponse.json({ error: "Side bet not found" }, { status: 404 });
  }
  if (sideBet.status === "settled") {
    return NextResponse.json({ error: "Side bet is already settled" }, { status: 400 });
  }

  let body: { answer?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const answer = body.answer?.trim();
  if (!answer) {
    return NextResponse.json({ error: "Answer is required" }, { status: 400 });
  }

  const entry = await db.sideBetEntry.upsert({
    where: { sideBetId_userId: { sideBetId, userId } },
    create: { sideBetId, userId, answer },
    update: { answer },
  });

  return NextResponse.json({
    id: entry.id,
    sideBetId: entry.sideBetId,
    userId: entry.userId,
    answer: entry.answer,
  });
}
