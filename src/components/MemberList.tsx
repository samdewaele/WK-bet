"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

type Member = {
  userId: string;
  name: string | null;
  image: string | null;
};

export default function MemberList({
  roomId,
  members,
  currentUserId,
  creatorId,
  isManager,
  tournamentStarted,
}: {
  roomId: string;
  members: Member[];
  currentUserId: string;
  creatorId: string | null;
  isManager: boolean;
  tournamentStarted: boolean;
}) {
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function handleRemove(targetUserId: string, targetName: string) {
    const isSelf = targetUserId === currentUserId;
    const verb = isSelf ? "leave this group" : `remove ${targetName}`;
    if (!confirm(`Are you sure you want to ${verb}?`)) return;

    setRemoving(targetUserId);
    setError("");
    try {
      const res = await fetch(`/api/groups/${roomId}/members/${targetUserId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Action failed");
      } else {
        if (isSelf) {
          router.push("/groups");
        } else {
          router.refresh();
        }
      }
    } catch {
      setError("Network error");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white">
          Members <span className="text-gray-500 font-normal text-base ml-1">({members.length})</span>
        </h2>
      </div>

      {tournamentStarted && (
        <div className="mb-4 flex items-center gap-2 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
          <span>🔒</span>
          <span>Tournament in progress — membership is locked</span>
        </div>
      )}

      {error && (
        <div className="mb-3 text-sm text-red-400">{error}</div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {members.map((member, i) => {
          const isCreator = member.userId === creatorId;
          const isSelf = member.userId === currentUserId;
          const canRemove = isManager && !isCreator && !tournamentStarted;
          const canLeave = isSelf && !isCreator && !tournamentStarted;
          const isLoading = removing === member.userId;

          return (
            <div
              key={member.userId}
              className={`flex items-center gap-3 px-4 py-3 ${
                i < members.length - 1 ? "border-b border-gray-800" : ""
              }`}
            >
              {/* Avatar */}
              <div className="w-9 h-9 rounded-full bg-gray-700 overflow-hidden shrink-0 flex items-center justify-center text-sm font-semibold text-gray-300">
                {member.image ? (
                  <Image
                    src={member.image}
                    alt={member.name ?? ""}
                    width={36}
                    height={36}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  (member.name ?? "?")[0].toUpperCase()
                )}
              </div>

              {/* Name + badges */}
              <div className="flex-1 min-w-0">
                <span className="text-sm text-white font-medium truncate block">
                  {member.name ?? "Unknown"}
                </span>
                <div className="flex gap-1.5 mt-0.5">
                  {isCreator && (
                    <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded-full">
                      Creator
                    </span>
                  )}
                  {isSelf && (
                    <span className="text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded-full">
                      You
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 shrink-0">
                {canLeave && (
                  <button
                    onClick={() => handleRemove(member.userId, member.name ?? "you")}
                    disabled={isLoading}
                    className="text-xs text-gray-400 hover:text-red-400 disabled:opacity-40 transition-colors px-2 py-1 rounded hover:bg-red-400/10"
                  >
                    {isLoading ? "…" : "Leave"}
                  </button>
                )}
                {canRemove && !isSelf && (
                  <button
                    onClick={() => handleRemove(member.userId, member.name ?? "this member")}
                    disabled={isLoading}
                    className="text-xs text-gray-500 hover:text-red-400 disabled:opacity-40 transition-colors px-2 py-1 rounded hover:bg-red-400/10"
                  >
                    {isLoading ? "…" : "Remove"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
