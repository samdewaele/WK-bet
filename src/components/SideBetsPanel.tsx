"use client";

import { useState, useEffect } from "react";

type SideBetEntry = {
  id: string;
  userId: string;
  userName: string | null;
  userImage: string | null;
  answer: string;
};

type SideBet = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  winnerEntryId: string | null;
  createdAt: string;
  entries: SideBetEntry[];
};

type Props = {
  roomId: string;
  currentUserId: string;
  isAdmin: boolean;
  sideBetCount: number;
};

export default function SideBetsPanel({ roomId, currentUserId, isAdmin, sideBetCount: initialCount }: Props) {
  const [sideBets, setSideBets] = useState<SideBet[]>([]);
  const [loading, setLoading] = useState(true);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  async function fetchSideBets() {
    const res = await fetch(`/api/groups/${roomId}/sidebets`);
    if (res.ok) {
      const data: SideBet[] = await res.json();
      setSideBets(data);
      const drafts: Record<string, string> = {};
      for (const sb of data) {
        const myEntry = sb.entries.find((e) => e.userId === currentUserId);
        if (myEntry) drafts[sb.id] = myEntry.answer;
      }
      setAnswerDrafts(drafts);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchSideBets();
  }, [roomId]);

  async function handleSubmitAnswer(sideBetId: string) {
    const answer = answerDrafts[sideBetId]?.trim();
    if (!answer) return;
    setSubmitting((prev) => ({ ...prev, [sideBetId]: true }));
    try {
      const res = await fetch(`/api/groups/${roomId}/sidebets/${sideBetId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      if (res.ok) await fetchSideBets();
    } finally {
      setSubmitting((prev) => ({ ...prev, [sideBetId]: false }));
    }
  }

  async function handleSettle(sideBetId: string, winnerEntryId: string) {
    const res = await fetch(`/api/groups/${roomId}/sidebets`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sideBetId, winnerEntryId }),
    });
    if (res.ok) await fetchSideBets();
  }

  async function handleCreate() {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/groups/${roomId}/sidebets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim(), description: newDesc.trim() || undefined }),
      });
      if (res.ok) {
        setNewTitle("");
        setNewDesc("");
        await fetchSideBets();
      }
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return <div className="animate-pulse bg-gray-900 border border-gray-800 rounded-xl h-48" />;
  }

  return (
    <div className="space-y-6">
      {sideBets.length === 0 && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 text-orange-300 text-sm">
          No side bets yet. At least 1 is required for the Uber Pot to be distributed.
        </div>
      )}

      {isAdmin && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-amber-400 mb-3">Create Side Bet (Admin)</h3>
          <div className="space-y-3">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Question / title"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-amber-400 text-sm"
            />
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-amber-400 text-sm"
            />
            <button
              onClick={handleCreate}
              disabled={creating || !newTitle.trim()}
              className="bg-amber-400 hover:bg-amber-300 text-gray-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create Side Bet"}
            </button>
          </div>
        </div>
      )}

      {sideBets.map((sb) => {
        const myEntry = sb.entries.find((e) => e.userId === currentUserId);
        const isSettled = sb.status === "settled";
        const winnerEntry = sb.entries.find((e) => e.id === sb.winnerEntryId);

        return (
          <div key={sb.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h3 className="font-semibold text-white">{sb.title}</h3>
                {sb.description && (
                  <p className="text-sm text-gray-400 mt-0.5">{sb.description}</p>
                )}
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                  isSettled
                    ? "bg-green-500/20 text-green-400"
                    : "bg-blue-500/20 text-blue-400"
                }`}
              >
                {isSettled ? "Settled" : "Open"}
              </span>
            </div>

            {isSettled && winnerEntry && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 mb-3 text-sm">
                <span className="text-gray-400">Winner: </span>
                <span className="text-green-400 font-semibold">
                  {winnerEntry.userName ?? "Unknown"} — "{winnerEntry.answer}"
                </span>
              </div>
            )}

            {!isSettled && (
              <div className="mb-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={answerDrafts[sb.id] ?? ""}
                    onChange={(e) =>
                      setAnswerDrafts((prev) => ({ ...prev, [sb.id]: e.target.value }))
                    }
                    placeholder={myEntry ? `Your answer: ${myEntry.answer}` : "Your answer..."}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-amber-400 text-sm"
                  />
                  <button
                    onClick={() => handleSubmitAnswer(sb.id)}
                    disabled={submitting[sb.id] || !answerDrafts[sb.id]?.trim()}
                    className="bg-amber-400 hover:bg-amber-300 text-gray-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
                  >
                    {submitting[sb.id] ? "..." : myEntry ? "Update" : "Submit"}
                  </button>
                </div>
              </div>
            )}

            {sb.entries.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-2">{sb.entries.length} {sb.entries.length === 1 ? "entry" : "entries"}</div>
                <div className="space-y-1.5">
                  {sb.entries.map((entry) => (
                    <div
                      key={entry.id}
                      className={`flex items-center justify-between text-sm rounded-lg px-3 py-2 ${
                        entry.id === sb.winnerEntryId
                          ? "bg-green-500/10 border border-green-500/20"
                          : "bg-gray-800"
                      }`}
                    >
                      <span className="text-gray-300">
                        <span className="font-medium text-white">{entry.userName ?? "?"}</span>
                        {entry.userId === currentUserId && (
                          <span className="text-amber-400 ml-1 text-xs">(you)</span>
                        )}
                        : {entry.answer}
                      </span>
                      {isAdmin && !isSettled && (
                        <button
                          onClick={() => handleSettle(sb.id, entry.id)}
                          className="text-xs bg-green-600 hover:bg-green-500 text-white px-2 py-0.5 rounded transition-colors"
                        >
                          Winner
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
