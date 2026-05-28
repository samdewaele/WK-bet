import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@auth";
import { db } from "@/lib/db";
import Navbar from "@/components/Navbar";
import CreateJoinGroupForms from "@/components/CreateJoinGroupForms";
import { calculatePot } from "@/lib/pot";

export default async function GroupsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const userId = session.user.id;

  const memberships = await db.roomMember.findMany({
    where: { userId },
    include: {
      room: {
        include: {
          members: true,
          sideBets: true,
        },
      },
    },
    orderBy: { room: { createdAt: "desc" } },
  });

  const groups = memberships.map((m) => {
    const pot = calculatePot(m.room.entryFee, m.room.members.length);
    return {
      id: m.room.id,
      name: m.room.name,
      inviteCode: m.room.inviteCode,
      entryFee: m.room.entryFee,
      status: m.room.status,
      memberCount: m.room.members.length,
      sideBetCount: m.room.sideBets.length,
      totalPot: pot.totalPot,
    };
  });

  const hasGroups = groups.length > 0;

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      setup: "bg-gray-700 text-gray-300",
      open: "bg-blue-500/20 text-blue-400",
      locked: "bg-orange-500/20 text-orange-400",
      active: "bg-green-500/20 text-green-400",
      finished: "bg-purple-500/20 text-purple-400",
    };
    return map[status] ?? "bg-gray-700 text-gray-300";
  };

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">My Betting Groups</h1>
          {!hasGroups && (
            <p className="text-gray-400 mt-1">Create a group or join one with an invite code.</p>
          )}
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
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="text-lg font-semibold text-white">{g.name}</h3>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadge(g.status)}`}>
                          {g.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-4 text-sm text-gray-400 mt-2">
                        <span>{g.memberCount} {g.memberCount === 1 ? "member" : "members"}</span>
                        <span>Entry: €{g.entryFee.toFixed(2)}</span>
                        <span>Pot: €{g.totalPot.toFixed(2)}</span>
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
