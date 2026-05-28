import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";

type Params = { params: Promise<{ roomId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId } = await params;

  // Allow group creator or platform admin
  const room = await db.room.findUnique({ where: { id: roomId }, select: { creatorId: true } });
  if (!room) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isCreator = room.creatorId === session.user.id;
  const isPlatformAdmin = session.user.role === "admin";
  if (!isCreator && !isPlatformAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { name?: string; entryFee?: number; status?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.entryFee === "number" && body.entryFee >= 0) data.entryFee = body.entryFee;
  const VALID_STATUSES = ["setup", "open", "locked", "active", "finished"];
  if (typeof body.status === "string" && VALID_STATUSES.includes(body.status)) data.status = body.status;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await db.room.update({ where: { id: roomId }, data });
  return NextResponse.json({ id: updated.id, name: updated.name, entryFee: updated.entryFee, status: updated.status });
}
