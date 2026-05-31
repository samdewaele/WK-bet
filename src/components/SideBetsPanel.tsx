"use client";

import { useState, useEffect } from "react";

type Entry = {
  id: string;
  userId: string;
  userName: string | null;
  userImage: string | null;
  answer: string;
};

type UberBet = {
  id: string;
  title: string;
  description: string | null;
  status: "proposed" | "open" | "settled";
  winnerEntryId: string | null;
  createdAt: string;
  proposedByUserId: string | null;
  proposedByName: string | null;
  entryCount: number;
  isManager: boolean;
  entries: Entry[];
};

type Props = {
  roomId: string;
  currentUserId: string;
  isManager: boolean;
  tournamentStarted: boolean;
  uberBetsLocked?: boolean;
  totalPot: number;
};

const STATUS_BADGE: Record<string, string> = {
  proposed: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
  open:     "bg-blue-500/20 text-blue-400 border border-blue-500/30",
  settled:  "bg-green-500/20 text-green-400 border border-green-500/30",
};
const STATUS_LABEL: Record<string, string> = {
  proposed: "Pending",
  open: "Open",
  settled: "Settled",
};

export default function SideBetsPanel({ roomId, currentUserId, isManager, tournamentStarted, uberBetsLocked = false, totalPot }: Props) {
  const [bets, setBets] = useState<UberBet[]>([]);
  const [loading, setLoading] = useState(true);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [acting, setActing] = useState<Record<string, boolean>>({});
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [pendingSettle, setPendingSettle] = useState<{
    betId: string; entryId: string; entryAnswer: string; entryName: string;
  } | null>(null);

  async function fetchBets() {
    const res = await fetch(`/api/groups/${roomId}/sidebets`);
    if (res.ok) {
      const data: UberBet[] = await res.json();
      setBets(data);
      const drafts: Record<string, string> = {};
      for (const bet of data) {
        const mine = bet.entries.find((e) => e.userId === currentUserId);
        if (mine) drafts[bet.id] = mine.answer;
      }
      setAnswerDrafts(drafts);
    }
    setLoading(false);
  }

  useEffect(() => { fetchBets(); }, [roomId]);

  async function handleSubmitAnswer(betId: string) {
    const answer = answerDrafts[betId]?.trim();
    if (!answer) return;
    setSubmitting((p) => ({ ...p, [betId]: true }));
    try {
      const res = await fetch(`/api/groups/${roomId}/sidebets/${betId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      if (res.ok) await fetchBets();
    } finally {
      setSubmitting((p) => ({ ...p, [betId]: false }));
    }
  }

  async function handlePatch(body: Record<string, unknown>, betId: string) {
    setActing((p) => ({ ...p, [betId]: true }));
    try {
      const res = await fetch(`/api/groups/${roomId}/sidebets`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) await fetchBets();
    } finally {
      setActing((p) => ({ ...p, [betId]: false }));
    }
  }

  async function handleCreate() {
    if (!newTitle.trim()) return;
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch(`/api/groups/${roomId}/sidebets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim(), description: newDesc.trim() || undefined }),
      });
      if (res.ok) {
        setNewTitle("");
        setNewDesc("");
        await fetchBets();
      } else {
        setCreateError((await res.json()).error ?? "Failed to create");
      }
    } finally {
      setCreating(false);
    }
  }

  const activeBetCount = bets.filter((b) => b.status === "open" || b.status === "settled").length;
  const estimatedPayoutPerBet = activeBetCount > 0 ? totalPot / activeBetCount : 0;

  if (loading) return <div className="animate-pulse bg-gray-900 border border-gray-800 rounded-xl h-48" />;

  return (
    <div className="space-y-6">
      {/* Header stats */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div>
          <span className="text-gray-500">Active bets</span>
          <span className="ml-2 font-bold text-white">{activeBetCount}</span>
        </div>
        <div>
          <span className="text-gray-500">Est. prize per winning bet</span>
          <span className="ml-2 font-bold text-amber-400">
            {activeBetCount > 0 ? `≈ €${estimatedPayoutPerBet.toFixed(2)}` : "—"}
          </span>
        </div>
        {(tournamentStarted || uberBetsLocked) && (
          <span className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-1.5">
            🔒 {uberBetsLocked && !tournamentStarted ? "Locked by admin" : "Locked — all answers revealed"}
          </span>
        )}
      </div>

      {activeBetCount === 0 && !tournamentStarted && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 text-orange-300 text-sm">
          No active Uber Pot Bets yet. At least 1 is required for the Uber Pot to be distributed.
        </div>
      )}

      {/* Bet cards — shown first */}
      {bets.map((bet) => {
        const myEntry = bet.entries.find((e) => e.userId === currentUserId);
        const isSettled = bet.status === "settled";
        const isProposed = bet.status === "proposed";
        const isOpen = bet.status === "open";
        const winnerEntry = bet.entries.find((e) => e.id === bet.winnerEntryId);
        const isActing = acting[bet.id];
        const otherEntryCount = bet.entryCount - (myEntry ? 1 : 0);

        return (
          <div key={bet.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            {/* Title row */}
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-white">{bet.title}</h3>
                {bet.description && <p className="text-sm text-gray-400 mt-0.5">{bet.description}</p>}
                {bet.proposedByName && (
                  <p className="text-xs text-gray-600 mt-1">Proposed by {bet.proposedByName}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[bet.status]}`}>
                  {STATUS_LABEL[bet.status]}
                </span>
                {!isSettled && !uberBetsLocked && !tournamentStarted &&
                  (isManager || bet.proposedByUserId === currentUserId) && (
                  <button
                    onClick={() => handlePatch({ sideBetId: bet.id, action: "cancel" }, bet.id)}
                    disabled={isActing}
                    title="Cancel this bet"
                    className="text-xs text-gray-500 hover:text-red-400 transition-colors disabled:opacity-40"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Proposed — admin actions */}
            {isProposed && isManager && (
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => handlePatch({ sideBetId: bet.id, action: "accept" }, bet.id)}
                  disabled={isActing}
                  className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                >
                  {isActing ? "…" : "✓ Accept"}
                </button>
                <button
                  onClick={() => handlePatch({ sideBetId: bet.id, action: "reject" }, bet.id)}
                  disabled={isActing}
                  className="bg-red-900 hover:bg-red-800 disabled:opacity-50 text-red-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                >
                  {isActing ? "…" : "✗ Reject"}
                </button>
              </div>
            )}

            {/* Proposed — regular member */}
            {isProposed && !isManager && (
              <div className="mb-4 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
                Awaiting admin approval before members can submit answers.
              </div>
            )}

            {/* Settled winner banner */}
            {isSettled && winnerEntry && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 mb-4 text-sm">
                <span className="text-gray-400">Winner: </span>
                <span className="text-green-400 font-semibold">
                  {winnerEntry.userName ?? "Unknown"} — &quot;{winnerEntry.answer}&quot;
                </span>
              </div>
            )}

            {/* Answer input — open + pre-lock */}
            {isOpen && !tournamentStarted && !uberBetsLocked && (
              <div className="mb-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={answerDrafts[bet.id] ?? ""}
                    onChange={(e) => setAnswerDrafts((p) => ({ ...p, [bet.id]: e.target.value }))}
                    placeholder={myEntry ? `Your answer: ${myEntry.answer}` : "Your answer…"}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-amber-400 text-sm"
                  />
                  <button
                    onClick={() => handleSubmitAnswer(bet.id)}
                    disabled={submitting[bet.id] || !answerDrafts[bet.id]?.trim()}
                    className="bg-amber-400 hover:bg-amber-300 text-gray-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
                  >
                    {submitting[bet.id] ? "…" : myEntry ? "Update" : "Submit"}
                  </button>
                </div>
                {bet.entryCount > 0 && (
                  <p className="text-xs text-gray-500 mt-2">
                    {myEntry
                      ? `Your answer submitted${otherEntryCount > 0 ? ` · ${otherEntryCount} other ${otherEntryCount === 1 ? "member has" : "members have"} answered` : ""}`
                      : `${bet.entryCount} ${bet.entryCount === 1 ? "member has" : "members have"} answered — revealed at tournament start`}
                  </p>
                )}
                {bet.entryCount === 0 && <p className="text-xs text-gray-600 mt-2">No answers yet — be the first!</p>}
              </div>
            )}

            {/* Entries list — after lock or settled */}
            {(tournamentStarted || isSettled) && bet.entries.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-2 flex items-center justify-between">
                  <span>{bet.entries.length} {bet.entries.length === 1 ? "entry" : "entries"}</span>
                  {isOpen && activeBetCount > 0 && (
                    <span className="text-amber-400 font-medium">≈ €{estimatedPayoutPerBet.toFixed(2)} if you win</span>
                  )}
                </div>
                {isManager && isOpen && (
                  <p className="text-xs text-blue-400/70 mb-2">
                    Click <strong>Set winner</strong> next to the correct entry to settle this bet.
                  </p>
                )}
                <div className="space-y-1.5">
                  {bet.entries.map((entry) => {
                    const isWinner = entry.id === bet.winnerEntryId;
                    const isPending = pendingSettle?.betId === bet.id && pendingSettle?.entryId === entry.id;
                    return (
                      <div
                        key={entry.id}
                        className={`flex items-center justify-between text-sm rounded-lg px-3 py-2.5 ${
                          isWinner
                            ? "bg-green-500/10 border border-green-500/30"
                            : isPending
                              ? "bg-amber-500/10 border border-amber-500/30"
                              : "bg-gray-800"
                        }`}
                      >
                        <span className="text-gray-300 flex-1 min-w-0 mr-2">
                          <span className="font-medium text-white">{entry.userName ?? "?"}</span>
                          {entry.userId === currentUserId && (
                            <span className="text-amber-400 ml-1 text-xs">(you)</span>
                          )}
                          {isWinner && <span className="ml-1.5 text-green-400 text-xs font-semibold">🏆 Winner</span>}
                          <span className="text-gray-400">: {entry.answer}</span>
                        </span>
                        {isManager && isOpen && !isPending && (
                          <button
                            onClick={() => setPendingSettle({
                              betId: bet.id, entryId: entry.id,
                              entryAnswer: entry.answer, entryName: entry.userName ?? "?",
                            })}
                            className="text-xs bg-gray-700 hover:bg-green-700 text-gray-300 hover:text-white px-2.5 py-1 rounded-lg transition-colors shrink-0 border border-gray-600 hover:border-green-600"
                          >
                            Set winner
                          </button>
                        )}
                        {isManager && isOpen && isPending && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-xs text-amber-300">Confirm?</span>
                            <button
                              onClick={async () => {
                                setPendingSettle(null);
                                await handlePatch({ sideBetId: bet.id, winnerEntryId: entry.id }, bet.id);
                              }}
                              disabled={isActing}
                              className="text-xs bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white px-2.5 py-1 rounded-lg transition-colors font-semibold"
                            >
                              {isActing ? "…" : "Yes, winner"}
                            </button>
                            <button
                              onClick={() => setPendingSettle(null)}
                              className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 px-2 py-1 rounded-lg transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {bets.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-8">No Uber Pot Bets yet.</p>
      )}

      {/* Propose / create form — at bottom */}
      {!tournamentStarted && !uberBetsLocked && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-amber-400 mb-1">
            {isManager ? "Create Uber Pot Bet" : "Propose an Uber Pot Bet"}
          </h3>
          {!isManager && (
            <p className="text-xs text-gray-500 mb-3">The group admin will review your proposal before it goes live.</p>
          )}
          <div className="space-y-3 mt-3">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Question / title"
              maxLength={200}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-amber-400 text-sm"
            />
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description / clarification (optional)"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-amber-400 text-sm"
            />
            {createError && <p className="text-xs text-red-400">{createError}</p>}
            <button
              onClick={handleCreate}
              disabled={creating || !newTitle.trim()}
              className="bg-amber-400 hover:bg-amber-300 text-gray-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {creating ? "Submitting…" : isManager ? "Create" : "Propose"}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
