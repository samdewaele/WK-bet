// Runs once when the Next.js server starts.
// Schedules automatic match result syncing every 5 minutes in production
// when FOOTBALL_DATA_API_KEY is present.

const SYNC_INTERVAL_MS      = 5 * 60 * 1000; // 5 minutes when idle
const SYNC_INTERVAL_LIVE_MS = 10_000;          // 10 seconds during a live match
const WARMUP_DELAY_MS       = 30_000;          // let DB settle before first sync

export async function register() {
  // register() is called for every runtime. Skip the Edge invocation.
  // NEXT_RUNTIME is "edge" in Edge, "nodejs" in Node.js, or absent — only
  // skip when explicitly "edge" so the guard works in all Node.js contexts.
  if (process.env.NEXT_RUNTIME === "edge") return;
  // No API key → nothing to sync
  if (!process.env.FOOTBALL_DATA_API_KEY) return;

  const { syncMatches } = await import("@/lib/sync-matches");

  // Self-scheduling loop: next sync fires 10 s after the current one completes
  // when a match is live, 5 min otherwise. Using setTimeout (not setInterval)
  // means the next tick only starts after the previous one finishes, so a slow
  // API response can never queue up concurrent syncs.
  const run = async () => {
    let nextDelay = SYNC_INTERVAL_MS;
    try {
      const result = await syncMatches();
      if (result.updated > 0) {
        console.log(`[cron/sync] ${result.message}`);
      }
      if (result.hasLiveMatches) {
        nextDelay = SYNC_INTERVAL_LIVE_MS;
        console.log(`[cron/sync] Live match detected — next sync in ${SYNC_INTERVAL_LIVE_MS / 1000}s`);
      }
    } catch (err) {
      console.error("[cron/sync] error:", err instanceof Error ? err.message : err);
    }
    setTimeout(run, nextDelay);
  };

  console.log(`[cron/sync] Starting — first sync in ${WARMUP_DELAY_MS / 1000}s`);
  setTimeout(run, WARMUP_DELAY_MS);
}
