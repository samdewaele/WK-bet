"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import InviteButton from "@/components/InviteButton";

type Member = {
  userId: string;
  name: string | null;
  image: string | null;
  paid: boolean;
};

type Team = { id: string; name: string; flag: string };
type StandingGroup = { wcGroup: string; positions: Team[]; earnedAmount: number | null };
type KOPrediction = {
  matchId: string;
  homeScore: number;
  awayScore: number;
  earnedAmount: number | null;
  match: {
    round: string;
    matchNumber: number;
    kickoff: string;
    homeTeam: Team | null;
    awayTeam: Team | null;
    homeScore: number | null;
    awayScore: number | null;
    status: string;
  };
};
type PredictionsData = {
  groupStandings: StandingGroup[];
  knockoutPredictions: KOPrediction[];
} | null;

const ROUND_LABELS: Record<string, string> = {
  R32: "R32", R16: "R16", QF: "QF", SF: "SF", "3rd": "3rd", Final: "Final",
};

export default function MemberList({
  roomId,
  members,
  currentUserId,
  creatorId,
  isManager,
  tournamentStarted,
  inviteCode,
}: {
  roomId: string;
  members: Member[];
  currentUserId: string;
  creatorId: string | null;
  isManager: boolean;
  tournamentStarted: boolean;
  inviteCode: string;
}) {
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);
  const [togglingPaid, setTogglingPaid] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<Record<string, PredictionsData>>({});
  const [loadingPreds, setLoadingPreds] = useState<string | null>(null);

  const paidCount = members.filter((m) => m.paid).length;

  async function handleRemove(targetUserId: string, targetName: string) {
    const isSelf = targetUserId === currentUserId;
    const verb = isSelf ? "leave this group" : `remove ${targetName}`;
    if (!confirm(`Are you sure you want to ${verb}?`)) return;

    setRemoving(targetUserId);
    setError("");
    try {
      const res = await fetch(`/api/groups/${roomId}/members/${targetUserId}`, { method: "DELETE" });
      if (!res.ok) { setError((await res.json()).error ?? "Action failed"); }
      else if (isSelf) { router.push("/groups"); }
      else { router.refresh(); }
    } catch { setError("Network error"); }
    finally { setRemoving(null); }
  }

  async function handleTogglePaid(targetUserId: string, currentPaid: boolean) {
    setTogglingPaid(targetUserId);
    try {
      const res = await fetch(`/api/groups/${roomId}/members/${targetUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paid: !currentPaid }),
      });
      if (res.ok) router.refresh();
    } finally { setTogglingPaid(null); }
  }

  async function handleViewPredictions(targetUserId: string) {
    if (expandedUserId === targetUserId) {
      setExpandedUserId(null);
      return;
    }
    setExpandedUserId(targetUserId);
    if (predictions[targetUserId] !== undefined) return;
    setLoadingPreds(targetUserId);
    try {
      const res = await fetch(`/api/groups/${roomId}/members/${targetUserId}/predictions`);
      if (res.ok) {
        const data = await res.json();
        setPredictions((prev) => ({ ...prev, [targetUserId]: data }));
      } else {
        setPredictions((prev) => ({ ...prev, [targetUserId]: null }));
      }
    } finally {
      setLoadingPreds(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold text-white">
          Members
          <span className="text-gray-500 font-normal text-base ml-2">({members.length})</span>
          {isManager && (
            <span className="ml-3 text-sm font-normal text-gray-400">
              {paidCount}/{members.length} paid
            </span>
          )}
        </h2>
        {!tournamentStarted && <InviteButton inviteCode={inviteCode} />}
      </div>

      {tournamentStarted && (
        <div className="mb-4 flex items-center gap-2 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
          <span>🔒</span>
          <span>Tournament in progress — membership is locked. Click any member to view their predictions.</span>
        </div>
      )}

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {members.map((member, i) => {
          const isCreator = member.userId === creatorId;
          const isSelf = member.userId === currentUserId;
          const canRemove = isManager && !isCreator && !tournamentStarted;
          const canLeave = isSelf && !isCreator && !tournamentStarted;
          const isRemoving = removing === member.userId;
          const isToggling = togglingPaid === member.userId;
          const isExpanded = expandedUserId === member.userId;
          const memberPreds = predictions[member.userId];
          const isLoadingThis = loadingPreds === member.userId;

          return (
            <div key={member.userId} className={i < members.length - 1 ? "border-b border-gray-800" : ""}>
              <div
                className={`flex items-center gap-3 px-4 py-3 ${tournamentStarted ? "cursor-pointer hover:bg-gray-800/40 transition-colors" : ""} ${isExpanded ? "bg-gray-800/40" : ""}`}
                onClick={tournamentStarted ? () => handleViewPredictions(member.userId) : undefined}
              >
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-gray-700 overflow-hidden shrink-0 flex items-center justify-center text-sm font-semibold text-gray-300">
                  {member.image ? (
                    <Image src={member.image} alt={member.name ?? ""} width={36} height={36} className="w-full h-full object-cover" />
                  ) : (
                    (member.name ?? "?")[0].toUpperCase()
                  )}
                </div>

                {/* Name + badges */}
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-white font-medium truncate block">{member.name ?? "Unknown"}</span>
                  <div className="flex gap-1.5 mt-0.5 flex-wrap">
                    {isCreator && (
                      <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded-full">Creator</span>
                    )}
                    {isSelf && (
                      <span className="text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded-full">You</span>
                    )}
                  </div>
                </div>

                {/* Payment status (manager only) */}
                {isManager && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleTogglePaid(member.userId, member.paid); }}
                    disabled={isToggling}
                    title={member.paid ? "Mark as unpaid" : "Mark as paid"}
                    className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                      member.paid
                        ? "border-green-500/40 bg-green-500/10 text-green-400 hover:bg-green-500/20"
                        : "border-gray-700 bg-gray-800 text-gray-500 hover:border-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {isToggling ? "…" : member.paid ? "✓ Paid" : "Unpaid"}
                  </button>
                )}

                {/* Remove / Leave */}
                <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {canLeave && (
                    <button
                      onClick={() => handleRemove(member.userId, member.name ?? "you")}
                      disabled={isRemoving}
                      className="text-xs text-gray-400 hover:text-red-400 disabled:opacity-40 transition-colors px-2 py-1 rounded hover:bg-red-400/10"
                    >
                      {isRemoving ? "…" : "Leave"}
                    </button>
                  )}
                  {canRemove && !isSelf && (
                    <button
                      onClick={() => handleRemove(member.userId, member.name ?? "this member")}
                      disabled={isRemoving}
                      className="text-xs text-gray-500 hover:text-red-400 disabled:opacity-40 transition-colors px-2 py-1 rounded hover:bg-red-400/10"
                    >
                      {isRemoving ? "…" : "Remove"}
                    </button>
                  )}
                  {tournamentStarted && (
                    <span className="text-xs text-gray-600 self-center ml-1">
                      {isExpanded ? "▲" : "▼"}
                    </span>
                  )}
                </div>
              </div>

              {/* Predictions panel */}
              {isExpanded && tournamentStarted && (
                <div className="px-4 pb-4 bg-gray-800/20 border-t border-gray-800">
                  {isLoadingThis ? (
                    <p className="text-xs text-gray-500 py-3">Loading predictions…</p>
                  ) : !memberPreds ? (
                    <p className="text-xs text-gray-500 py-3">No predictions available.</p>
                  ) : (
                    <div className="pt-3 space-y-4">
                      {memberPreds.groupStandings.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-amber-400 mb-2">Group Stage Standings</h4>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                            {memberPreds.groupStandings.map((g) => (
                              <div key={g.wcGroup} className="bg-gray-800 rounded-lg p-2">
                                <div className="text-xs font-bold text-amber-400 mb-1">Group {g.wcGroup}</div>
                                {g.positions.map((team, pos) => (
                                  <div key={team.id} className="flex items-center gap-1 text-xs text-gray-300 py-0.5">
                                    <span className="text-gray-600 w-3">{pos + 1}.</span>
                                    <span>{team.flag}</span>
                                    <span className="truncate">{team.name}</span>
                                  </div>
                                ))}
                                {g.earnedAmount != null && g.earnedAmount > 0 && (
                                  <div className="text-xs text-green-400 font-bold mt-1">+€{g.earnedAmount.toFixed(2)}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {memberPreds.knockoutPredictions.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-amber-400 mb-2">Knockout Predictions</h4>
                          <div className="space-y-1">
                            {memberPreds.knockoutPredictions.map((p) => (
                              <div key={p.matchId} className="flex items-center justify-between text-xs text-gray-300 bg-gray-800 rounded px-2 py-1.5">
                                <span className="text-gray-500 w-8">{ROUND_LABELS[p.match.round] ?? p.match.round}</span>
                                <span className="flex-1 text-center">
                                  {p.match.homeTeam?.flag} {p.match.homeTeam?.name ?? "TBD"}
                                  <span className="mx-1 text-white font-bold">{p.homeScore}–{p.awayScore}</span>
                                  {p.match.awayTeam?.name ?? "TBD"} {p.match.awayTeam?.flag}
                                </span>
                                {p.earnedAmount != null && p.earnedAmount > 0 && (
                                  <span className="text-green-400 font-bold ml-2">+€{p.earnedAmount.toFixed(2)}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {memberPreds.groupStandings.length === 0 && memberPreds.knockoutPredictions.length === 0 && (
                        <p className="text-xs text-gray-500">This member has no predictions on record.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
