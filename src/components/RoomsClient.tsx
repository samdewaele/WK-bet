"use client";

import { useState } from "react";
import Link from "next/link";

type Room = {
  id: string;
  name: string;
  inviteCode: string;
  memberCount: number;
  createdAt: string;
};

type Props = {
  rooms: Room[];
};

export default function RoomsClient({ rooms: initialRooms }: Props) {
  const [rooms, setRooms] = useState<Room[]>(initialRooms);
  const [createName, setCreateName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [createError, setCreateError] = useState("");
  const [joinError, setJoinError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;
    setCreateLoading(true);
    setCreateError("");
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create room");
      setRooms((prev) => [
        ...prev,
        {
          id: data.id,
          name: data.name,
          inviteCode: data.inviteCode,
          memberCount: data.memberCount ?? 1,
          createdAt: data.createdAt,
        },
      ]);
      setCreateName("");
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Failed to create room");
    } finally {
      setCreateLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setJoinLoading(true);
    setJoinError("");
    try {
      const res = await fetch("/api/rooms", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: joinCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to join room");
      if (!rooms.find((r) => r.id === data.id)) {
        setRooms((prev) => [
          ...prev,
          {
            id: data.id,
            name: data.name,
            inviteCode: data.inviteCode,
            memberCount: data.memberCount ?? 1,
            createdAt: data.createdAt,
          },
        ]);
      }
      setJoinCode("");
    } catch (err: unknown) {
      setJoinError(err instanceof Error ? err.message : "Failed to join room");
    } finally {
      setJoinLoading(false);
    }
  };

  const copyInviteCode = async (room: Room) => {
    try {
      await navigator.clipboard.writeText(room.inviteCode);
      setCopiedId(room.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback silently
    }
  };

  return (
    <div className="space-y-8">
      {/* Action cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Create room */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-1">Create a room</h2>
          <p className="text-gray-400 text-sm mb-4">
            Start a private leaderboard and invite friends.
          </p>
          <form onSubmit={handleCreate} className="flex flex-col gap-3">
            <input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Room name…"
              maxLength={50}
              className="bg-gray-800 border border-gray-700 focus:border-amber-400 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 outline-none text-sm"
            />
            {createError && (
              <p className="text-red-400 text-xs">{createError}</p>
            )}
            <button
              type="submit"
              disabled={createLoading || !createName.trim()}
              className="bg-amber-400 hover:bg-amber-300 text-gray-900 font-semibold py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createLoading ? "Creating…" : "Create room"}
            </button>
          </form>
        </div>

        {/* Join room */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-1">Join a room</h2>
          <p className="text-gray-400 text-sm mb-4">
            Enter an invite code to join a friend&apos;s room.
          </p>
          <form onSubmit={handleJoin} className="flex flex-col gap-3">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="Invite code…"
              className="bg-gray-800 border border-gray-700 focus:border-amber-400 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 outline-none text-sm font-mono"
            />
            {joinError && (
              <p className="text-red-400 text-xs">{joinError}</p>
            )}
            <button
              type="submit"
              disabled={joinLoading || !joinCode.trim()}
              className="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {joinLoading ? "Joining…" : "Join room"}
            </button>
          </form>
        </div>
      </div>

      {/* Room list */}
      <div>
        <h2 className="text-xl font-bold text-white mb-4">Your rooms</h2>
        {rooms.length === 0 ? (
          <div className="text-center py-16 bg-gray-900 border border-gray-800 rounded-xl text-gray-500">
            <div className="text-4xl mb-3">🏠</div>
            <p>You are not in any rooms yet. Create or join one above.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {rooms.map((room) => (
              <div
                key={room.id}
                className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-white text-base">{room.name}</h3>
                    <p className="text-gray-400 text-xs mt-0.5">
                      {room.memberCount} member{room.memberCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <Link
                    href={`/rooms/${room.id}`}
                    className="shrink-0 text-xs bg-amber-400/10 hover:bg-amber-400/20 text-amber-400 font-semibold px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Leaderboard →
                  </Link>
                </div>

                {/* Invite code */}
                <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
                  <span className="text-gray-400 text-xs font-medium shrink-0">Invite:</span>
                  <code className="text-amber-400 text-xs font-mono flex-1 truncate">
                    {room.inviteCode}
                  </code>
                  <button
                    onClick={() => copyInviteCode(room)}
                    className="shrink-0 text-xs text-gray-400 hover:text-white transition-colors"
                    title="Copy invite code"
                  >
                    {copiedId === room.id ? "✓ Copied" : "Copy"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
