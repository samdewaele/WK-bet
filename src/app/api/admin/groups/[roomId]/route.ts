import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";

type Params = { params: Promise<{ roomId: string }> };

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (session.user.role !== "admin") return null;
  return session.user;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { roomId } = await params;

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

  const room = await db.room.update({ where: { id: roomId }, data });
  return NextResponse.json({ id: room.id, name: room.name, entryFee: room.entryFee, status: room.status });
}
