"use client";

import { useState } from "react";

type SyncResult = {
  updated: number;
  predictionsScored: number;
  message: string;
};

export default function SyncButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState("");

  async function handleSync() {
    setLoading(true);
    setResult(null);
    setError("");
    try {
      const res = await fetch("/api/admin/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Sync failed");
      } else {
        setResult(data);
      }
    } catch {
      setError("Network error — could not reach server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={handleSync}
        disabled={loading}
        className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
      >
        {loading ? (
          <>
            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Syncing…
          </>
        ) : (
          <>⟳ Sync results</>
        )}
      </button>

      {result && (
        <span className="text-sm text-green-400">{result.message}</span>
      )}
      {error && (
        <span className="text-sm text-red-400">{error}</span>
      )}
    </div>
  );
}
