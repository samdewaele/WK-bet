import { NextResponse } from "next/server";
import { auth } from "@auth";
import {
  getTestPhase,
  seedGroupStageInRoom,
  seedKOStageInRoom,
  cleanupTestInRoom,
  buildReport,
} from "@/lib/test-tournament";

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
  const phase = await getTestPhase(roomId);
  if (phase === 0) return NextResponse.json({ seeded: false, phase: 0 });
  const report = await buildReport(roomId);
  return NextResponse.json({ seeded: true, phase, report });
}

export async function POST(req: Request, { params }: Params) {
  if (!await requireAdmin()) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { roomId } = await params;
  const body = await req.json().catch(() => ({}));
  const phaseReq: number = body.phase ?? 1;

  try {
    if (phaseReq === 2) {
      const report = await seedKOStageInRoom(roomId);
      return NextResponse.json({ report });
    } else {
      const report = await seedGroupStageInRoom(roomId);
      return NextResponse.json({ report });
    }
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
