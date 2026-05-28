import { NextResponse } from "next/server";
import { auth } from "@auth";
import { getTestInRoomStatus, seedIntoRoom, cleanupTestInRoom, buildReport } from "@/lib/test-tournament";

type Params = { params: Promise<{ roomId: string }> };

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (session.user.role !== "admin") return null;
  return session.user;
}

export async function GET(_req: Request, { params }: Params) {
  if (!await requireAdmin()) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { roomId } = await params;
  const seeded = await getTestInRoomStatus(roomId);
  if (!seeded) return NextResponse.json({ seeded: false });
  const report = await buildReport(roomId);
  return NextResponse.json({ seeded: true, report });
}

export async function POST(_req: Request, { params }: Params) {
  if (!await requireAdmin()) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { roomId } = await params;
  try {
    const report = await seedIntoRoom(roomId);
    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Seed failed" },
      { status: 502 }
    );
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  if (!await requireAdmin()) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { roomId } = await params;
  await cleanupTestInRoom(roomId);
  return NextResponse.json({ ok: true });
}
