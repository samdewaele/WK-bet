"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CreateJoinGroupForms({ collapsed = false }: { collapsed?: boolean }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [createError, setCreateError] = useState("");
  const [joinError, setJoinError] = useState("");
  const [expanded, setExpanded] = useState(!collapsed);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateError("");
    setCreating(true);
    const fd = new FormData(e.currentTarget);
    const name = (fd.get("name") as string).trim();
    const entryFee = parseFloat((fd.get("entryFee") as string) || "0");
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, entryFee: isNaN(entryFee) ? 0 : entryFee }),
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data.error ?? "Something went wrong"); return; }
      router.push(`/groups/${data.id}`);
      router.refresh();
    } catch {
      setCreateError("Network error. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleJoin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setJoinError("");
    setJoining(true);
    const fd = new FormData(e.currentTarget);
    const raw = (fd.get("inviteCode") as string).trim();
    // Accept full invite URLs like https://domain.com/join/CODE or just the bare code
    const urlMatch = raw.match(/\/join\/([^/?#\s]+)/);
    const inviteCode = urlMatch ? urlMatch[1] : raw;
    try {
      const res = await fetch("/api/groups", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode }),
      });
      const data = await res.json();
      if (!res.ok) { setJoinError(data.error ?? "Something went wrong"); return; }
      router.push(`/groups/${data.id}`);
      router.refresh();
    } catch {
      setJoinError("Network error. Please try again.");
    } finally {
      setJoining(false);
    }
  }

  if (collapsed && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full flex items-center justify-center gap-2 border border-dashed border-gray-700 hover:border-amber-400/50 text-gray-400 hover:text-amber-400 rounded-xl py-3 text-sm font-medium transition-colors"
      >
        <span className="text-lg">＋</span> Join or create another group
      </button>
    );
  }

  return (
    <div>
      {collapsed && (
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Join or create a group</h2>
          <button
            onClick={() => setExpanded(false)}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            ✕ Close
          </button>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 mb-10">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-amber-400 mb-4">Create Group</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <input
              type="text"
              name="name"
              placeholder="Group name"
              maxLength={50}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-amber-400"
            />
            <input
              type="number"
              name="entryFee"
              placeholder="Entry fee (€) — optional"
              min={0}
              step={0.01}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-amber-400"
            />
            {createError && <p className="text-red-400 text-sm">{createError}</p>}
            <button
              type="submit"
              disabled={creating}
              className="w-full bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-900 font-semibold py-2 rounded-lg transition-colors"
            >
              {creating ? "Creating…" : "Create Group"}
            </button>
          </form>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-amber-400 mb-4">Join Group</h2>
          <form onSubmit={handleJoin} className="space-y-3">
            <input
              type="text"
              name="inviteCode"
              placeholder="Invite code"
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-amber-400"
            />
            {joinError && <p className="text-red-400 text-sm">{joinError}</p>}
            <button
              type="submit"
              disabled={joining}
              className="w-full bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-semibold py-2 rounded-lg transition-colors"
            >
              {joining ? "Joining…" : "Join Group"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
