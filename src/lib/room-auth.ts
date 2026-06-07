import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";

type Session = { user: { id: string; role: string; name?: string | null; email?: string | null; image?: string | null } };

type RoomAccess = { session: Session; isPlatformAdmin: boolean };

/**
 * Verifies that the caller is either a member of the room or a platform admin.
 * Returns { session, isPlatformAdmin } on success, or a NextResponse (401/403) to return early.
 */
export async function requireRoomAccess(roomId: string): Promise<RoomAccess | NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isPlatformAdmin = session.user.role === "admin";
  if (isPlatformAdmin) {
    return { session: session as Session, isPlatformAdmin: true };
  }

  const membership = await db.roomMember.findUnique({
    where: { userId_roomId: { userId: session.user.id, roomId } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  return { session: session as Session, isPlatformAdmin: false };
}
