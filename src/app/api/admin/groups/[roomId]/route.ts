import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { isTournamentStarted } from "@/lib/tournament-lock";
import {
  emailBettingOpen,
  emailUberPotLocked,
  emailGroupStageStarted,
  emailGroupStageComplete,
  emailKOStageActive,
  emailSettlingStarted,
  emailTournamentFinished,
} from "@/lib/email";
import { buildRoomLeaderboard } from "@/lib/notifications";

type Params = { params: Promise<{ roomId: string }> };

async function resolveAccess(roomId: string, userId: string, role: string) {
  const room = await db.room.findUnique({ where: { id: roomId }, select: { creatorId: true } });
  if (!room) return null;
  const isCreator = room.creatorId === userId;
  const isPlatformAdmin = role === "admin";
  if (!isCreator && !isPlatformAdmin) return null;
  return { room, isCreator, isPlatformAdmin };
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId } = await params;
  const access = await resolveAccess(roomId, session.user.id, session.user.role ?? "");
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { name?: string; entryFee?: number; status?: string; simulationMode?: boolean; newCreatorId?: string; description?: string | null; uberBetsLocked?: boolean };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Transfer ownership
  if (body.newCreatorId) {
    const isMember = await db.roomMember.findUnique({
      where: { userId_roomId: { userId: body.newCreatorId, roomId } },
    });
    if (!isMember) return NextResponse.json({ error: "Target user is not a member" }, { status: 400 });
    const updated = await db.room.update({
      where: { id: roomId },
      data: { creatorId: body.newCreatorId },
    });
    return NextResponse.json({ id: updated.id, creatorId: updated.creatorId });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.entryFee === "number" && body.entryFee >= 0) data.entryFee = body.entryFee;
  if (typeof body.simulationMode === "boolean") data.simulationMode = body.simulationMode;
  if (typeof body.uberBetsLocked === "boolean") data.uberBetsLocked = body.uberBetsLocked;
  if ("description" in body) data.description = body.description?.trim() || null;
  const VALID_STATUSES = ["setup", "betting", "closed", "group_active", "ko_betting", "ko_active", "settling", "finished"];
  if (typeof body.status === "string" && VALID_STATUSES.includes(body.status)) data.status = body.status;

  // Guard: cannot finish a tournament until every Uber Pot bet is settled.
  if (data.status === "finished") {
    const unsettled = await db.sideBet.count({ where: { roomId, status: "open" } });
    if (unsettled > 0) {
      return NextResponse.json(
        { error: `Settle all ${unsettled} open Uber Pot bet${unsettled > 1 ? "s" : ""} before finishing the tournament.` },
        { status: 400 },
      );
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await db.room.update({ where: { id: roomId }, data });

  // Fire status-change and uberBetsLocked emails in the background.
  const newStatus = data.status as string | undefined;
  const uberLocked = data.uberBetsLocked === true;
  if (newStatus || uberLocked) {
    (async () => {
      const room = await db.room.findUnique({
        where: { id: roomId },
        select: {
          name: true,
          entryFee: true,
          members: { include: { user: { select: { name: true, email: true } } } },
        },
      });
      if (!room) return;

      const needsLeaderboard = newStatus && ["ko_betting", "ko_active", "settling", "finished"].includes(newStatus);
      const leaderboard = needsLeaderboard ? await buildRoomLeaderboard(roomId) : [];

      for (const member of room.members) {
        const { email, name } = member.user;
        if (!email) continue;
        const n = name ?? "there";

        if (newStatus === "betting")      emailBettingOpen(email, n, room.name, roomId, room.entryFee).catch(() => {});
        if (newStatus === "group_active") emailGroupStageStarted(email, n, room.name, roomId).catch(() => {});
        if (newStatus === "ko_betting")   emailGroupStageComplete(email, n, room.name, roomId, leaderboard).catch(() => {});
        if (newStatus === "ko_active")    emailKOStageActive(email, n, room.name, roomId, leaderboard).catch(() => {});
        if (newStatus === "settling")     emailSettlingStarted(email, n, room.name, roomId, leaderboard).catch(() => {});
        if (newStatus === "finished")     emailTournamentFinished(email, n, room.name, roomId, leaderboard).catch(() => {});
        if (uberLocked)                   emailUberPotLocked(email, n, room.name, roomId).catch(() => {});
      }
    })().catch(() => {});
  }

  return NextResponse.json({ id: updated.id, name: updated.name, entryFee: updated.entryFee, status: updated.status, simulationMode: updated.simulationMode });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId } = await params;
  const access = await resolveAccess(roomId, session.user.id, session.user.role ?? "");
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (await isTournamentStarted()) {
    return NextResponse.json({ error: "Tournament has started — cannot disband a group" }, { status: 403 });
  }

  // Cascade delete everything in the room
  await db.sideBetEntry.deleteMany({ where: { sideBet: { roomId } } });
  await db.sideBet.deleteMany({ where: { roomId } });
  await db.p2PSideBet.deleteMany({ where: { roomId } });
  await db.groupStandingPrediction.deleteMany({ where: { roomId } });
  await db.kOPrediction.deleteMany({ where: { roomId } });
  await db.prediction.deleteMany({ where: { roomId } });
  await db.roomMember.deleteMany({ where: { roomId } });
  await db.room.delete({ where: { id: roomId } });

  return NextResponse.json({ ok: true });
}
