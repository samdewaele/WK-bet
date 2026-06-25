import type { Metadata } from "next";
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
import SharedPredictions from "@/components/SharedPredictions";
import P2PBetsPanel from "@/components/P2PBetsPanel";
import GroupAdminPanel from "@/components/GroupAdminPanel";
import MemberList from "@/components/MemberList";
import InviteButton from "@/components/InviteButton";
import { isTournamentStarted, getGroupKickoffTimes } from "@/lib/tournament-lock";
import CountdownTimer from "@/components/CountdownTimer";
import RecentResults from "@/components/RecentResults";
import { computeUberPotResults } from "@/lib/uber-pot";

type Props = {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ tab?: string }>;
};

export async function generateMetadata({ params }: { params: Promise<{ roomId: string }> }): Promise<Metadata> {
  const { roomId } = await params;
  const room = await db.room.findUnique({ where: { id: roomId }, select: { name: true } });
  return { title: room ? `${room.name} — WK Bet 2026` : "WK Bet 2026" };
}

export default async function GroupDetailPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const { roomId } = await params;
  const { tab: rawTab = "predictions" } = await searchParams;
  // Backward compat: "leaderboard" → "standings"
  const tab = rawTab === "leaderboard" ? "standings" : rawTab;
  const userId = session.user.id;
  const isPlatformAdmin = session.user.role === "admin";

  const membership = isPlatformAdmin
    ? true
    : await db.roomMember.findUnique({ where: { userId_roomId: { userId, roomId } } });
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
  const isManager = room.creatorId === userId || isPlatformAdmin;
  const [tournamentStarted, groupKickoffTimes, uberPotResults] = await Promise.all([
    isTournamentStarted(),
    getGroupKickoffTimes(),
    computeUberPotResults(roomId),
  ]);
  const roomStatus = room.status;
  const simulationMode = room.simulationMode;
  const uberBetsLocked = room.uberBetsLocked;
  const description = room.description;

  // Fetch paid status for all members
  const membersPaid = await db.roomMember.findMany({
    where: { roomId },
    select: { userId: true, paid: true },
  });
  const paidMap = new Map(membersPaid.map((m) => [m.userId, m.paid]));

  // KO countdown: first R32 match that hasn't kicked off yet
  const firstKOMatch = roomStatus === "ko_betting"
    ? await db.match.findFirst({
        where: { round: "R32", kickoff: { gt: new Date() } },
        orderBy: { kickoff: "asc" },
        select: { kickoff: true },
      })
    : null;

  // Predictions tab is visible once any group's first match has kicked off (per-group reveal),
  // or when the room is in an advanced status.
  const anyGroupStarted = Object.values(groupKickoffTimes).some((t) => new Date() >= new Date(t));
  const showSharedPredictions =
    ["group_active", "ko_betting", "ko_active", "settling", "finished"].includes(roomStatus) ||
    anyGroupStarted;
  // Fall back to my-predictions if the shared tab isn't available yet.
  const activeTab = tab === "all-predictions" && !showSharedPredictions ? "predictions" : tab;

  const tabs = [
    { key: "predictions", label: "My predictions" },
    ...(showSharedPredictions ? [{ key: "all-predictions", label: "Predictions" }] : []),
    { key: "standings", label: "Standings" },
    { key: "sidebets-p2p", label: "Side Bets" },
    { key: "members", label: `Members (${room.members.length})` },
    { key: "rules", label: "How to play" },
  ];

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      <Navbar groupName={room.name} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Header */}
        <div className="mb-6">
          <Link href="/groups" className="text-gray-400 hover:text-amber-400 text-sm transition-colors">
            ← Back to groups
          </Link>
          <div className="flex items-start justify-between gap-4 mt-2">
            <div className="flex items-center gap-3 min-w-0">
              {room.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={room.image} alt={room.name} className="w-12 h-12 rounded-lg object-cover border border-gray-700 shrink-0" />
              )}
              <h1 className="text-3xl font-bold text-white">{room.name}</h1>
            </div>
            {isManager && (
              <GroupAdminPanel
                roomId={roomId}
                inviteCode={room.inviteCode}
                initialName={room.name}
                initialFee={room.entryFee}
                initialStatus={room.status}
                initialSimulationMode={room.simulationMode}
                initialCreatorId={room.creatorId}
                isPlatformAdmin={isPlatformAdmin}
                currentUserId={userId}
                members={room.members.map((m) => ({ userId: m.userId, name: m.user.name }))}
                initialDescription={room.description}
                initialUberBetsLocked={room.uberBetsLocked}
                initialImage={room.image}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-400 mt-1">
            <span>{room.members.length} members</span>
            <span>Entry: €{room.entryFee.toFixed(2)}</span>
            <span className="text-amber-400 font-semibold">Total pot: €{pot.totalPot.toFixed(2)}</span>
            {tournamentStarted && (
              <span className="text-amber-400 font-semibold">Uber Pot: €{uberPotResults.accumulatedUberPot.toFixed(2)}</span>
            )}
            {/* Managers always see the invite button; others only in pre-tournament phases */}
            {(isManager || ((roomStatus === "betting" || roomStatus === "setup") && !tournamentStarted)) && (
              <InviteButton inviteCode={room.inviteCode} />
            )}
          </div>
          {description && (
            <p className="text-sm text-gray-400 mt-2 max-w-2xl">{description}</p>
          )}
        </div>

        {/* Recent results — visible once any match has finished */}
        {tournamentStarted && <RecentResults />}

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
                  activeTab === t.key
                    ? "bg-amber-400 text-gray-900"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white"
                }`}
              >
                {t.label}
              </Link>
            )
          )}
        </div>

        {/* Stage-aware banners */}
        {simulationMode && (
          <div className="mb-4 flex items-center gap-2 text-sm text-violet-300 bg-violet-500/10 border border-violet-500/20 rounded-xl px-4 py-3">
            <span>🧪</span>
            <span>Simulation mode — this is a test run, not the real tournament.</span>
          </div>
        )}
        {(roomStatus === "group_active" || roomStatus === "ko_betting" || roomStatus === "ko_active") && (
          <div className="mb-4 flex items-center gap-2 text-sm text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-3">
            <span>🔒</span>
            {roomStatus === "group_active" && <span>Group stage in progress — no new members can join. Group standings predictions are locked.</span>}
            {roomStatus === "ko_betting" && <span>Group stage complete — fill in your knockout bracket predictions before the first KO match kicks off!</span>}
            {roomStatus === "ko_active" && <span>Knockout stage in progress — KO predictions are locked.</span>}
          </div>
        )}
        {roomStatus === "settling" && (
          <div className="mb-4 flex items-center gap-2 text-sm text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-3">
            <span>⏳</span>
            <span>Final whistle! The admin is settling the Uber Pot categories — final earnings are confirmed once every category has a winner.</span>
          </div>
        )}
        {roomStatus === "finished" && (
          <div className="mb-4 flex items-center gap-2 text-sm text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-xl px-4 py-3">
            <span>🏆</span>
            <span>Tournament finished — check the standings to see the final results.</span>
          </div>
        )}
        {(roomStatus === "setup" || roomStatus === "betting" || roomStatus === "closed") && !tournamentStarted && (
          <div className="mb-4">
            <CountdownTimer />
          </div>
        )}
        {roomStatus === "ko_betting" && firstKOMatch && (
          <div className="mb-4">
            <CountdownTimer
              target={firstKOMatch.kickoff.toISOString()}
              label="First KO match in"
              finishedMessage="KO stage is live! 🏆"
            />
          </div>
        )}

        {/* Tab content */}
        {activeTab === "predictions" && (
          <div className="space-y-8">
            <div>
              <h2 className="text-xl font-bold text-white mb-4">Group Stage Standings</h2>
              <GroupStandingsPicker roomId={roomId} roomStatus={roomStatus} groupKickoffTimes={groupKickoffTimes} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-4">Knockout Predictions</h2>
              <KnockoutPredictions roomId={roomId} roomStatus={roomStatus} simulationMode={simulationMode} />
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
                uberBetsLocked={uberBetsLocked}
                bettingClosed={!["setup", "betting"].includes(roomStatus)}
              />
            </div>
          </div>
        )}

        {activeTab === "all-predictions" && showSharedPredictions && (
          <div>
            <h2 className="text-xl font-bold text-white mb-2">Everyone&apos;s Predictions</h2>
            <p className="text-sm text-gray-400 mb-4">
              Group standings are visible to all once the group stage starts. Knockout picks are revealed when the bracket locks.
            </p>
            <SharedPredictions roomId={roomId} />
          </div>
        )}

        {activeTab === "standings" && (
          <GroupLeaderboard roomId={roomId} currentUserId={userId} totalPot={pot.totalPot} roomStatus={roomStatus} accumulatedUberPot={uberPotResults.accumulatedUberPot} />
        )}

        {activeTab === "sidebets-p2p" && (
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

        {activeTab === "members" && (
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
