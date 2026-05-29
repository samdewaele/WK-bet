import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@auth";
import { db } from "@/lib/db";
import Navbar from "@/components/Navbar";
import { calculatePot } from "@/lib/pot";
import GroupStandingsPicker from "@/components/GroupStandingsPicker";
import KnockoutPredictions from "@/components/KnockoutPredictions";
import GroupLeaderboard from "@/components/GroupLeaderboard";
import SideBetsPanel from "@/components/SideBetsPanel";
import P2PBetsPanel from "@/components/P2PBetsPanel";
import GroupAdminPanel from "@/components/GroupAdminPanel";
import MemberList from "@/components/MemberList";
import InviteButton from "@/components/InviteButton";
import { isTournamentStarted } from "@/lib/tournament-lock";
import CountdownTimer from "@/components/CountdownTimer";

type Props = {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ tab?: string }>;
};

export default async function GroupDetailPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const { roomId } = await params;
  const { tab: rawTab = "standings" } = await searchParams;
  // Backward compat: "leaderboard" → "standings"
  const tab = rawTab === "leaderboard" ? "standings" : rawTab;
  const userId = session.user.id;

  const membership = await db.roomMember.findUnique({
    where: { userId_roomId: { userId, roomId } },
  });
  if (!membership) redirect("/groups");

  const room = await db.room.findUnique({
    where: { id: roomId },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, image: true } } },
      },
      sideBets: {
        include: {
          entries: { include: { user: { select: { id: true, name: true, image: true } } } },
        },
      },
      p2pBets: {
        include: {
          proposer: { select: { id: true, name: true, image: true } },
          acceptor: { select: { id: true, name: true, image: true } },
        },
      },
    },
  });
  if (!room) redirect("/groups");

  const pot = calculatePot(room.entryFee, room.members.length);
  const isPlatformAdmin = session.user.role === "admin";
  const isManager = room.creatorId === userId || isPlatformAdmin;
  const tournamentStarted = await isTournamentStarted();

  // Fetch paid status for all members
  const membersPaid = await db.roomMember.findMany({
    where: { roomId },
    select: { userId: true, paid: true },
  });
  const paidMap = new Map(membersPaid.map((m) => [m.userId, m.paid]));

  const tabs = [
    { key: "predictions", label: "Predictions" },
    { key: "standings", label: "Standings" },
    { key: "sidebets-p2p", label: "Side Bets" },
    { key: "members", label: `Members (${room.members.length})` },
    { key: "rules", label: "How to play" },
  ];

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Header */}
        <div className="mb-6">
          <Link href="/groups" className="text-gray-400 hover:text-amber-400 text-sm transition-colors">
            ← Back to groups
          </Link>
          <div className="flex items-start justify-between gap-4 mt-2">
            <h1 className="text-3xl font-bold text-white">{room.name}</h1>
            {isManager && (
              <GroupAdminPanel
                roomId={roomId}
                initialName={room.name}
                initialFee={room.entryFee}
                initialStatus={room.status}
                initialCreatorId={room.creatorId}
                isPlatformAdmin={isPlatformAdmin}
                currentUserId={userId}
                members={room.members.map((m) => ({ userId: m.userId, name: m.user.name }))}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-400 mt-1">
            <span>{room.members.length} members</span>
            <span>Entry: €{room.entryFee.toFixed(2)}</span>
            <span className="text-amber-400 font-semibold">Total pot: €{pot.totalPot.toFixed(2)}</span>
            {!tournamentStarted && <InviteButton inviteCode={room.inviteCode} />}
          </div>
          {!tournamentStarted && (
            <div className="mt-3">
              <CountdownTimer />
            </div>
          )}
        </div>

        {/* Pot breakdown */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6 grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-xs text-gray-500 mb-1">Group Stage (50%)</div>
            <div className="text-xl font-bold text-amber-400">€{pot.groupStagePot.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Knockout (50%)</div>
            <div className="text-xl font-bold text-amber-400">€{pot.knockoutPot.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Per WC Group</div>
            <div className="text-xl font-bold text-white">€{pot.prizePerWCGroup.toFixed(2)}</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mb-8 border-b border-gray-800 pb-4">
          {tabs.map((t) =>
            t.key === "rules" ? (
              <Link
                key={t.key}
                href={`/groups/${roomId}/rules`}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
              >
                {t.label}
              </Link>
            ) : (
              <Link
                key={t.key}
                href={`/groups/${roomId}?tab=${t.key}`}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.key
                    ? "bg-amber-400 text-gray-900"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white"
                }`}
              >
                {t.label}
              </Link>
            )
          )}
        </div>

        {/* Tournament lock banner */}
        {tournamentStarted && (
          <div className="mb-6 flex items-center gap-2 text-sm text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-3">
            <span>🔒</span>
            <span>Tournament in progress — membership locked. Only Side Bets can still be placed.</span>
          </div>
        )}

        {/* Tab content */}
        {tab === "predictions" && (
          <div className="space-y-8">
            <div>
              <h2 className="text-xl font-bold text-white mb-4">Group Stage Standings</h2>
              <GroupStandingsPicker roomId={roomId} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-4">Knockout Predictions</h2>
              <KnockoutPredictions roomId={roomId} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-2">Uber Pot Bets</h2>
              <p className="text-sm text-gray-400 mb-4">
                Enter your answer for each bet below — the pot is split among winners when settled.
              </p>
              <SideBetsPanel
                roomId={roomId}
                currentUserId={userId}
                isManager={isManager}
                tournamentStarted={tournamentStarted}
                totalPot={pot.totalPot}
              />
            </div>
          </div>
        )}

        {tab === "standings" && (
          <GroupLeaderboard roomId={roomId} currentUserId={userId} totalPot={pot.totalPot} />
        )}

        {tab === "sidebets-p2p" && (
          <P2PBetsPanel
            roomId={roomId}
            currentUserId={userId}
            members={room.members.map((m) => ({
              userId: m.userId,
              name: m.user.name ?? "",
              image: m.user.image ?? null,
            }))}
          />
        )}

        {tab === "members" && (
          <MemberList
            roomId={roomId}
            members={room.members.map((m) => ({
              userId: m.userId,
              name: m.user.name,
              image: m.user.image,
              paid: paidMap.get(m.userId) ?? false,
            }))}
            currentUserId={userId}
            creatorId={room.creatorId}
            isManager={isManager}
            tournamentStarted={tournamentStarted}
            inviteCode={room.inviteCode}
          />
        )}
      </div>
    </div>
  );
}
