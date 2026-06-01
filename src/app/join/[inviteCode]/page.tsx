import { redirect } from "next/navigation";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { isTournamentStarted } from "@/lib/tournament-lock";
import { emailMemberJoined } from "@/lib/email";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ inviteCode: string }>;
}) {
  const { inviteCode } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    redirect(`/auth/signin?callbackUrl=/join/${inviteCode}`);
  }

  const room = await db.room.findUnique({
    where: { inviteCode },
    include: {
      members: { select: { userId: true } },
      creator: { select: { email: true } },
    },
  });

  if (!room) redirect("/groups");

  // Joining is blocked once the group is closed or the tournament has started
  const CLOSED_STATUSES = ["closed", "group_active", "ko_betting", "ko_active", "settling", "finished"];
  if (CLOSED_STATUSES.includes(room.status) || await isTournamentStarted()) {
    redirect("/groups?joinError=locked");
  }

  const userId = session.user.id;
  const alreadyMember = room.members.some((m) => m.userId === userId);

  if (!alreadyMember) {
    await db.roomMember.create({ data: { userId, roomId: room.id } });

    if (room.creator?.email) {
      const joiner = await db.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      emailMemberJoined(
        room.creator.email,
        joiner?.name ?? "Someone",
        room.name,
        room.id,
      ).catch(() => {});
    }
  }

  redirect(`/groups/${room.id}`);
}
