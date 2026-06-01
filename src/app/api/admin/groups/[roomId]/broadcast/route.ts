import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { emailAdminBroadcast } from "@/lib/email";

type Params = { params: Promise<{ roomId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId } = await params;
  const room = await db.room.findUnique({
    where: { id: roomId },
    select: { creatorId: true, name: true, members: { include: { user: { select: { name: true, email: true } } } } },
  });
  if (!room) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isCreator = room.creatorId === session.user.id;
  const isPlatformAdmin = session.user.role === "admin";
  if (!isCreator && !isPlatformAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { subject?: string; message?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const subject = body.subject?.trim();
  const message = body.message?.trim();
  if (!subject || !message) return NextResponse.json({ error: "subject and message are required" }, { status: 400 });

  let sent = 0;
  for (const member of room.members) {
    const { email, name } = member.user;
    if (!email) continue;
    emailAdminBroadcast(email, name ?? "there", room.name, roomId, subject, message).catch(() => {});
    sent++;
  }

  return NextResponse.json({ sent });
}
