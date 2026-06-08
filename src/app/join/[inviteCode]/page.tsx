import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { isTournamentStarted } from "@/lib/tournament-lock";
import { emailMemberJoined } from "@/lib/email";
import Navbar from "@/components/Navbar";

function JoinErrorPage({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      <Navbar />
      <div className="max-w-md mx-auto px-4 py-24 text-center">
        <div className="text-5xl mb-6">🔒</div>
        <h1 className="text-2xl font-bold text-white mb-3">{title}</h1>
        <p className="text-gray-400 mb-8">{detail}</p>
        <Link
          href="/groups"
          className="inline-block bg-amber-400 text-gray-900 font-semibold px-6 py-3 rounded-lg hover:bg-amber-300 transition-colors"
        >
          Go to my groups
        </Link>
      </div>
    </div>
  );
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ inviteCode: string }>;
}) {
  const { inviteCode } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    redirect(`/auth/signin?callbackUrl=${encodeURIComponent(`/join/${inviteCode}`)}`);
  }

  const room = await db.room.findUnique({
    where: { inviteCode },
    include: {
      members: { select: { userId: true } },
      creator: { select: { email: true } },
    },
  });

  if (!room) {
    return (
      <JoinErrorPage
        title="Invite link not found"
        detail="This invite link is invalid or has expired. Ask the group admin for a fresh link."
      />
    );
  }

  // Platform admins can always join any group regardless of status or tournament state
  const isPlatformAdmin = session.user.role === "admin";

  // Joining is blocked once the group is closed or the tournament has started
  const CLOSED_STATUSES = ["closed", "group_active", "ko_betting", "ko_active", "settling", "finished"];
  const tournamentStarted = !isPlatformAdmin && await isTournamentStarted();
  if (!isPlatformAdmin && (CLOSED_STATUSES.includes(room.status) || tournamentStarted)) {
    const detail = room.status === "setup" || room.status === "betting"
      ? "The tournament has already kicked off and new members can no longer join mid-way."
      : "This group is no longer accepting new members — it's already underway or has finished.";
    return (
      <JoinErrorPage
        title={`Can't join "${room.name}"`}
        detail={detail}
      />
    );
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
