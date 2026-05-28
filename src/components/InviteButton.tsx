"use client";

import { useState } from "react";

export default function InviteButton({ inviteCode }: { inviteCode: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}/join/${inviteCode}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-amber-400 transition-colors px-2 py-1 rounded hover:bg-amber-400/10"
    >
      {copied ? (
        <><span className="text-amber-400">✓</span> Copied!</>
      ) : (
        <><span>🔗</span> Copy invite link</>
      )}
    </button>
  );
}
