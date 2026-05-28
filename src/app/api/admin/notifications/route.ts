import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { checkAndSendRoundNotifications, resetNotification } from "@/lib/notifications";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const results = await checkAndSendRoundNotifications();
  return NextResponse.json({ triggered: results });
}

// DELETE /api/admin/notifications?round=Group  — reset so it fires again (for testing)
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const round = req.nextUrl.searchParams.get("round");
  if (!round) return NextResponse.json({ error: "round query param required" }, { status: 400 });

  await resetNotification(round);
  return NextResponse.json({ ok: true, reset: `round_complete:${round}` });
}
