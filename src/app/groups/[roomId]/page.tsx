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

type Props = {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ tab?: string }>;
};

export default async function GroupDetailPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const { roomId } = await params;
  const { tab = "predictions" } = await searchParams;
  const userId = session.user.id;

  const membership = await db.roomMember.findUnique({
    where: { userId_roomId: { userId, roomId } },
  });
  if (!membership) {
    redirect("/groups");
  }

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

  if (!room) {
    redirect("/groups");
  }

  const pot = calculatePot(room.entryFee, room.members.length);

  const tabs = [
    { key: "predictions", label: "Predictions" },
    { key: "leaderboard", label: "Leaderboard" },
    { key: "sidebets", label: "Side Bets" },
    { key: "p2p", label: "P2P Bets" },
    { key: "rules", label: "Rules" },
  ];

  const groupStagePct = room.members.length > 0 ? 50 : 0;
  const knockoutPct = room.members.length > 0 ? 50 : 0;

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
            {session.user.role === "admin" && (
              <GroupAdminPanel
                roomId={roomId}
                initialName={room.name}
                initialFee={room.entryFee}
                initialStatus={room.status}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-gray-400 mt-1">
            <span>{room.members.length} members</span>
            <span>Entry: €{room.entryFee.toFixed(2)}</span>
            <span className="text-amber-400 font-semibold">Total pot: €{pot.totalPot.toFixed(2)}</span>
            <span className="text-xs text-gray-600">Code: {room.inviteCode}</span>
          </div>
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
          </div>
        )}

        {tab === "leaderboard" && (
          <GroupLeaderboard
            roomId={roomId}
            currentUserId={userId}
            totalPot={pot.totalPot}
          />
        )}

        {tab === "sidebets" && (
          <SideBetsPanel
            roomId={roomId}
            currentUserId={userId}
            isAdmin={session.user.role === "admin"}
            sideBetCount={room.sideBets.length}
          />
        )}

        {tab === "p2p" && (
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
      </div>
    </div>
  );
}
