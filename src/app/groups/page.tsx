import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@auth";
import { db } from "@/lib/db";
import Navbar from "@/components/Navbar";
import CreateJoinGroupForms from "@/components/CreateJoinGroupForms";
import CountdownTimer from "@/components/CountdownTimer";
import { calculatePot } from "@/lib/pot";

export default async function GroupsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const userId = session.user.id;
  const isAdmin = session.user.role === "admin";

  const roomInclude = {
    members: {
      include: { user: { select: { id: true, name: true, image: true } } },
    },
    sideBets: true,
  };

  const rooms = isAdmin
    ? await db.room.findMany({ include: roomInclude, orderBy: { createdAt: "desc" } })
    : (
        await db.roomMember.findMany({
          where: { userId },
          include: { room: { include: roomInclude } },
          orderBy: { room: { createdAt: "desc" } },
        })
      ).map((m) => m.room);

  const groups = rooms.map((room) => {
    const pot = calculatePot(room.entryFee, room.members.length);
    return {
      id: room.id,
      name: room.name,
      inviteCode: room.inviteCode,
      entryFee: room.entryFee,
      status: room.status,
      memberCount: room.members.length,
      sideBetCount: room.sideBets.length,
      totalPot: pot.totalPot,
      members: room.members.slice(0, 6).map((rm) => ({
        id: rm.userId,
        name: rm.user.name,
        image: rm.user.image,
      })),
    };
  });

  const hasGroups = groups.length > 0;

  const statusLabel = (status: string) => {
    const labels: Record<string, string> = {
      setup: "Setup",
      betting: "Open",
      closed: "Closed",
      group_active: "Group stage",
      ko_betting: "KO betting",
      ko_active: "KO stage",
      finished: "Finished",
    };
    return labels[status] ?? status;
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      setup: "bg-gray-700 text-gray-300",
      betting: "bg-blue-500/20 text-blue-400",
      closed: "bg-orange-500/20 text-orange-400",
      group_active: "bg-green-500/20 text-green-400",
      ko_betting: "bg-amber-500/20 text-amber-400",
      ko_active: "bg-emerald-500/20 text-emerald-400",
      finished: "bg-purple-500/20 text-purple-400",
    };
    return map[status] ?? "bg-gray-700 text-gray-300";
  };

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white">
            {isAdmin ? "All Betting Groups" : "My Betting Groups"}
          </h1>
          {isAdmin && (
            <p className="text-xs text-violet-400 mt-1">Viewing all groups as platform admin</p>
          )}
          {!hasGroups && (
            <p className="text-gray-400 mt-1">Create a group or join one with an invite code.</p>
          )}
        </div>

        <div className="mb-8">
          <CountdownTimer />
        </div>

        {/* Show existing groups first when user has them */}
        {hasGroups ? (
          <>
            <div className="space-y-4 mb-8">
              {groups.map((g) => (
                <Link
                  key={g.id}
                  href={`/groups/${g.id}`}
                  className="block bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-amber-400/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="text-lg font-semibold text-white">{g.name}</h3>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadge(g.status)}`}>
                          {statusLabel(g.status)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-4 text-sm text-gray-400 mt-1">
                        <span>{g.memberCount} {g.memberCount === 1 ? "member" : "members"}</span>
                        <span>Entry: €{g.entryFee.toFixed(2)}</span>
                        <span className="text-amber-400 font-semibold">Pot: €{g.totalPot.toFixed(2)}</span>
                      </div>
                      {/* Member avatars */}
                      <div className="flex items-center gap-1.5 mt-3">
                        {g.members.map((m) => (
                          <div
                            key={m.id}
                            className="w-7 h-7 rounded-full border border-gray-700 overflow-hidden flex items-center justify-center text-xs font-semibold text-gray-300 bg-gray-800 shrink-0"
                            title={m.name ?? undefined}
                          >
                            {m.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={m.image} alt={m.name ?? ""} className="w-full h-full object-cover" />
                            ) : (
                              (m.name ?? "?")[0].toUpperCase()
                            )}
                          </div>
                        ))}
                        {g.memberCount > 6 && (
                          <span className="text-xs text-gray-500">+{g.memberCount - 6}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-amber-400 text-xl shrink-0">→</div>
                  </div>
                </Link>
              ))}
            </div>

            {/* Collapsible join/create section */}
            <CreateJoinGroupForms collapsed />
          </>
        ) : (
          <>
            {/* No groups yet: show forms prominently */}
            <CreateJoinGroupForms />

            <div className="text-center py-16 text-gray-500">
              <div className="text-5xl mb-4">🏆</div>
              <p className="text-lg">No groups yet. Create one or join with an invite code.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
