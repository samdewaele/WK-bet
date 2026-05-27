"use client";

import { useState, useEffect } from "react";
import Image from "next/image";

type Member = {
  userId: string;
  name: string;
  image: string | null;
};

type P2PBet = {
  id: string;
  proposerId: string;
  proposerName: string | null;
  proposerImage: string | null;
  acceptorId: string | null;
  acceptorName: string | null;
  acceptorImage: string | null;
  amount: number;
  description: string;
  status: string;
  winner: string | null;
  createdAt: string;
};

type Props = {
  roomId: string;
  currentUserId: string;
  members: Member[];
};

const STATUS_LABELS: Record<string, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  declined: "Declined",
  settled: "Settled",
};

const STATUS_COLORS: Record<string, string> = {
  proposed: "bg-yellow-500/20 text-yellow-400",
  accepted: "bg-blue-500/20 text-blue-400",
  declined: "bg-red-500/20 text-red-400",
  settled: "bg-green-500/20 text-green-400",
};

export default function P2PBetsPanel({ roomId, currentUserId, members }: Props) {
  const [bets, setBets] = useState<P2PBet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [proposing, setProposing] = useState(false);
  const [acting, setActing] = useState<Record<string, boolean>>({});

  async function fetchBets() {
    const res = await fetch(`/api/groups/${roomId}/p2p`);
    if (res.ok) {
      setBets(await res.json());
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchBets();
  }, [roomId]);

  async function handlePropose() {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0 || !description.trim()) return;

    setProposing(true);
    try {
      const res = await fetch(`/api/groups/${roomId}/p2p`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          description: description.trim(),
          targetUserId: targetUserId || undefined,
        }),
      });
      if (res.ok) {
        setShowForm(false);
        setAmount("");
        setDescription("");
        setTargetUserId("");
        await fetchBets();
      }
    } finally {
      setProposing(false);
    }
  }

  async function handleAction(betId: string, action: string, winner?: string) {
    setActing((prev) => ({ ...prev, [betId]: true }));
    try {
      const res = await fetch(`/api/groups/${roomId}/p2p`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ betId, action, winner }),
      });
      if (res.ok) await fetchBets();
    } finally {
      setActing((prev) => ({ ...prev, [betId]: false }));
    }
  }

  const otherMembers = members.filter((m) => m.userId !== currentUserId);

  if (loading) {
    return <div className="animate-pulse bg-gray-900 border border-gray-800 rounded-xl h-48" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm((v) => !v)}
          className="bg-amber-400 hover:bg-amber-300 text-gray-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
        >
          {showForm ? "Cancel" : "+ Propose Bet"}
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-900 border border-amber-400/30 rounded-xl p-5 space-y-3">
          <h3 className="font-semibold text-amber-400 text-sm">New P2P Bet</h3>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is the bet about?"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-amber-400 text-sm"
          />
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-400 mb-1 block">Amount (€)</label>
              <input
                type="number"
                min={0.01}
                step={0.01}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-amber-400 text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-400 mb-1 block">Target player (optional)</label>
              <select
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-400 text-sm"
              >
                <option value="">— Anyone —</option>
                {otherMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={handlePropose}
            disabled={proposing || !description.trim() || !amount}
            className="bg-amber-400 hover:bg-amber-300 text-gray-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {proposing ? "Proposing..." : "Propose Bet"}
          </button>
        </div>
      )}

      {bets.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p>No P2P bets yet. Challenge someone!</p>
        </div>
      )}

      {bets.map((bet) => {
        const isProposer = bet.proposerId === currentUserId;
        const isAcceptor = bet.acceptorId === currentUserId;
        const canAccept =
          bet.status === "proposed" &&
          !isProposer &&
          (!bet.acceptorId || bet.acceptorId === currentUserId);
        const canDecline = bet.status === "proposed" && (isProposer || isAcceptor);
        const canSettle = bet.status === "accepted" && isProposer;

        return (
          <div key={bet.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <p className="font-medium text-white">{bet.description}</p>
                <p className="text-xl font-bold text-amber-400 mt-1">€{bet.amount.toFixed(2)}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[bet.status] ?? ""}`}>
                {STATUS_LABELS[bet.status] ?? bet.status}
              </span>
            </div>

            <div className="flex items-center gap-4 text-sm text-gray-400 mb-4">
              <div className="flex items-center gap-2">
                {bet.proposerImage ? (
                  <Image src={bet.proposerImage} alt="" width={20} height={20} className="rounded-full" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center text-gray-900 text-xs font-bold">
                    {bet.proposerName?.[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <span className={isProposer ? "text-amber-400" : "text-gray-300"}>
                  {bet.proposerName ?? "Unknown"}
                  {isProposer && " (you)"}
                </span>
              </div>
              <span className="text-gray-600">vs</span>
              {bet.acceptorId ? (
                <div className="flex items-center gap-2">
                  {bet.acceptorImage ? (
                    <Image src={bet.acceptorImage} alt="" width={20} height={20} className="rounded-full" />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-gray-600 flex items-center justify-center text-white text-xs font-bold">
                      {bet.acceptorName?.[0]?.toUpperCase() ?? "?"}
                    </div>
                  )}
                  <span className={isAcceptor ? "text-amber-400" : "text-gray-300"}>
                    {bet.acceptorName ?? "Unknown"}
                    {isAcceptor && " (you)"}
                  </span>
                </div>
              ) : (
                <span className="text-gray-600 italic">Open to all</span>
              )}
            </div>

            {bet.status === "settled" && bet.winner && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 text-sm text-green-400 mb-3">
                Winner: {bet.winner === "proposer" ? bet.proposerName : bet.acceptorName}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {canAccept && (
                <button
                  onClick={() => handleAction(bet.id, "accept")}
                  disabled={acting[bet.id]}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  Accept
                </button>
              )}
              {canDecline && (
                <button
                  onClick={() => handleAction(bet.id, "decline")}
                  disabled={acting[bet.id]}
                  className="bg-red-600 hover:bg-red-500 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  Decline
                </button>
              )}
              {canSettle && (
                <>
                  <button
                    onClick={() => handleAction(bet.id, "settle", "proposer")}
                    disabled={acting[bet.id]}
                    className="bg-green-600 hover:bg-green-500 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    I won
                  </button>
                  <button
                    onClick={() => handleAction(bet.id, "settle", "acceptor")}
                    disabled={acting[bet.id]}
                    className="bg-gray-600 hover:bg-gray-500 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    They won
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
