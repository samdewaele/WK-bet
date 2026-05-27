import { NextResponse } from "next/server";
import { auth } from "@auth";
import {
  getTestTournamentStatus,
  runTestTournament,
  buildReport,
  cleanupTestTournament,
} from "@/lib/test-tournament";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (session.user.role !== "admin") return null;
  return session.user;
}

export async function GET() {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const status = await getTestTournamentStatus();
  if (!status.exists) return NextResponse.json({ exists: false });

  const report = await buildReport(status.roomId!);
  return NextResponse.json({ exists: true, report });
}

export async function POST() {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const report = await runTestTournament(user.id);
    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Test tournament failed" },
      { status: 502 }
    );
  }
}

export async function DELETE() {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await cleanupTestTournament();
  return NextResponse.json({ ok: true });
}
