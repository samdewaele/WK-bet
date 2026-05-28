// Email via Resend REST API — no npm package needed.
// Set RESEND_API_KEY + EMAIL_FROM in env. Falls back to console.log if unset.

const API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM ?? "WK-Bet 2026 <onboarding@resend.dev>";
const APP_URL = process.env.NEXTAUTH_URL ?? "https://wk-bet.fly.dev";

async function send(to: string, subject: string, html: string): Promise<void> {
  if (!to) return;
  if (!API_KEY) {
    console.log(`[email] ${subject} → ${to}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) {
    console.error("[email] Resend error:", res.status, await res.text());
  }
}

function wrap(body: string) {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a2e">
      <div style="font-size:22px;font-weight:bold;margin-bottom:16px">⚽ WK-Bet 2026</div>
      ${body}
      <div style="margin-top:32px;font-size:12px;color:#666">
        <a href="${APP_URL}" style="color:#f59e0b">Open WK-Bet</a>
      </div>
    </div>`;
}

export async function emailMemberJoined(
  creatorEmail: string,
  memberName: string,
  groupName: string,
  groupId: string,
): Promise<void> {
  await send(
    creatorEmail,
    `${memberName} joined "${groupName}"`,
    wrap(`<p><strong>${memberName}</strong> just joined your betting group <strong>${groupName}</strong>.</p>
          <p><a href="${APP_URL}/groups/${groupId}">View group →</a></p>`),
  );
}

export async function emailMemberLeft(
  creatorEmail: string,
  memberName: string,
  groupName: string,
  groupId: string,
): Promise<void> {
  await send(
    creatorEmail,
    `${memberName} left "${groupName}"`,
    wrap(`<p><strong>${memberName}</strong> has left your betting group <strong>${groupName}</strong>.</p>
          <p><a href="${APP_URL}/groups/${groupId}">View group →</a></p>`),
  );
}

export async function emailRemovedFromGroup(
  memberEmail: string,
  memberName: string,
  groupName: string,
): Promise<void> {
  await send(
    memberEmail,
    `You've been removed from "${groupName}"`,
    wrap(`<p>Hi ${memberName},</p>
          <p>You have been removed from the WK-Bet group <strong>${groupName}</strong>.</p>
          <p>If you think this was a mistake, contact your group admin directly.</p>`),
  );
}

export async function emailMemberRemovedByAdmin(
  creatorEmail: string,
  removedName: string,
  groupName: string,
  groupId: string,
  byAdminName: string,
): Promise<void> {
  await send(
    creatorEmail,
    `${removedName} was removed from "${groupName}"`,
    wrap(`<p><strong>${removedName}</strong> was removed from your group <strong>${groupName}</strong> by ${byAdminName}.</p>
          <p><a href="${APP_URL}/groups/${groupId}">View group →</a></p>`),
  );
}

type LeaderboardRow = { name: string; rank: number; earned: number };

function leaderboardHtml(rows: LeaderboardRow[]): string {
  if (rows.length === 0) return "";
  const items = rows
    .map((r) => `<tr><td style="padding:4px 8px;color:#9ca3af">${r.rank}</td><td style="padding:4px 8px;color:#fff;font-weight:600">${r.name}</td><td style="padding:4px 8px;color:#f59e0b;font-weight:700;text-align:right">€${r.earned.toFixed(2)}</td></tr>`)
    .join("");
  return `<table style="width:100%;border-collapse:collapse;margin:12px 0;background:#111827;border-radius:8px;overflow:hidden"><thead><tr style="border-bottom:1px solid #374151"><th style="padding:6px 8px;color:#6b7280;font-weight:normal;text-align:left">#</th><th style="padding:6px 8px;color:#6b7280;font-weight:normal;text-align:left">Player</th><th style="padding:6px 8px;color:#6b7280;font-weight:normal;text-align:right">Earned</th></tr></thead><tbody>${items}</tbody></table>`;
}

export async function emailGroupStageComplete(
  to: string,
  name: string,
  groupName: string,
  groupId: string,
  leaderboard: LeaderboardRow[],
): Promise<void> {
  await send(
    to,
    `⚽ Group stage done — submit your knockout predictions! (${groupName})`,
    wrap(`<p>Hi ${name},</p>
          <p>The <strong>group stage</strong> is complete! Here's the current standing in <strong>${groupName}</strong>:</p>
          ${leaderboardHtml(leaderboard)}
          <p style="margin-top:16px">Now it's time to submit your <strong>knockout stage predictions</strong> — don't wait, they lock when each match kicks off!</p>
          <p><a href="${APP_URL}/groups/${groupId}?tab=predictions" style="display:inline-block;background:#f59e0b;color:#111;font-weight:700;padding:10px 20px;border-radius:8px;text-decoration:none">Submit Knockout Predictions →</a></p>`),
  );
}

export const ROUND_LABELS: Record<string, string> = {
  Group: "Group stage",
  R32: "Round of 32", R16: "Round of 16", QF: "Quarter-finals",
  SF: "Semi-finals", "3rd": "Third-place play-off", Final: "Final",
};

export async function emailRoundComplete(
  to: string,
  name: string,
  round: string,
  groupName: string,
  groupId: string,
  leaderboard: LeaderboardRow[],
): Promise<void> {
  const label = ROUND_LABELS[round] ?? round;
  const isFinal = round === "Final";
  await send(
    to,
    `🏆 ${label} complete — see your standing! (${groupName})`,
    wrap(`<p>Hi ${name},</p>
          <p>The <strong>${label}</strong> is finished! Here's how <strong>${groupName}</strong> looks right now:</p>
          ${leaderboardHtml(leaderboard)}
          ${isFinal
            ? `<p>The tournament is over — final payouts will be calculated shortly. Thanks for playing!</p>`
            : `<p>Keep an eye on your predictions for the next round.</p>
               <p><a href="${APP_URL}/groups/${groupId}?tab=leaderboard" style="display:inline-block;background:#f59e0b;color:#111;font-weight:700;padding:10px 20px;border-radius:8px;text-decoration:none">View Full Leaderboard →</a></p>`
          }`),
  );
}

export async function emailIncompleteReminder(
  to: string,
  name: string,
  round: string,
  groupName: string,
  groupId: string,
  deadline: string,
  missingCount: number,
): Promise<void> {
  const label = ROUND_LABELS[round] ?? round;
  await send(
    to,
    `⏰ ${label} starts soon — you have ${missingCount} missing prediction${missingCount > 1 ? "s" : ""}! (${groupName})`,
    wrap(`<p>Hi ${name},</p>
          <p>The <strong>${label}</strong> kicks off <strong>${deadline}</strong> and you still have <strong>${missingCount} missing prediction${missingCount > 1 ? "s" : ""}</strong> in <strong>${groupName}</strong>.</p>
          <p>Predictions lock the moment each match kicks off — don't miss your chance!</p>
          <p><a href="${APP_URL}/groups/${groupId}?tab=predictions" style="display:inline-block;background:#f59e0b;color:#111;font-weight:700;padding:10px 20px;border-radius:8px;text-decoration:none">Submit Predictions Now →</a></p>`),
  );
}
