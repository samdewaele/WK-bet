// Email via Nodemailer + Gmail SMTP.
// Set EMAIL_USER + EMAIL_PASS (Gmail App Password) in env.
// Falls back to console.log if either is unset.

import nodemailer from "nodemailer";

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
export const APP_URL = process.env.NEXTAUTH_URL ?? "https://wk-bet.fly.dev";

const FROM = `WK-Bet 2026 <${EMAIL_USER ?? "wkbet@example.com"}>`;

function getTransporter() {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });
}

async function send(to: string, subject: string, html: string): Promise<void> {
  if (!to) return;
  if (!EMAIL_USER || !EMAIL_PASS) {
    console.log(`[email] ${subject} → ${to}`);
    return;
  }
  try {
    await getTransporter().sendMail({ from: FROM, to, subject, html });
  } catch (err) {
    console.error("[email] Send error:", err);
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

/** Simplified reminder sent to all members 24h before any round starts (no prediction count). */
export async function emailRoundReminder(
  to: string,
  name: string,
  round: string,
  groupName: string,
  groupId: string,
  deadline: string,
): Promise<void> {
  const label = ROUND_LABELS[round] ?? round;
  const isGroup = round === "Group";
  await send(
    to,
    `⏰ ${label} kicks off soon — check your predictions! (${groupName})`,
    wrap(`<p>Hi ${name},</p>
          <p>The <strong>${label}</strong> kicks off <strong>${deadline}</strong>.</p>
          ${isGroup
            ? `<p>Make sure your group stage predictions and Uber Pot entries are all submitted — they lock when the first match starts!</p>`
            : `<p>Make sure your knockout predictions are in — they lock the moment each match kicks off!</p>`
          }
          <p><a href="${APP_URL}/groups/${groupId}?tab=predictions" style="display:inline-block;background:#f59e0b;color:#111;font-weight:700;padding:10px 20px;border-radius:8px;text-decoration:none">Submit Predictions →</a></p>`),
  );
}

/** Sent when admin opens group for predictions (status → betting). */
export async function emailBettingOpen(
  to: string,
  name: string,
  groupName: string,
  groupId: string,
  entryFee: number,
): Promise<void> {
  await send(
    to,
    `🎯 Predictions are open in "${groupName}"!`,
    wrap(`<p>Hi ${name},</p>
          <p>Your betting group <strong>${groupName}</strong> is now open! Here's what to do before the group stage kicks off:</p>
          <ul style="padding-left:20px;line-height:1.8">
            <li>Submit your <strong>group stage predictions</strong> for all 12 groups — they lock when the first match starts</li>
            <li><strong>Propose Uber Pot categories</strong> — creative ideas welcome! The admin reviews and approves proposals. Once the Uber Pot closes, no new categories can be added</li>
          </ul>
          <p style="color:#9ca3af;font-size:13px">Entry fee: €${entryFee.toFixed(2)}</p>
          <p><a href="${APP_URL}/groups/${groupId}?tab=predictions" style="display:inline-block;background:#f59e0b;color:#111;font-weight:700;padding:10px 20px;border-radius:8px;text-decoration:none">Open ${groupName} →</a></p>`),
  );
}

/** Sent when admin locks Uber Pot proposals (uberBetsLocked → true). */
export async function emailUberPotLocked(
  to: string,
  name: string,
  groupName: string,
  groupId: string,
): Promise<void> {
  await send(
    to,
    `🔒 Uber Pot is closed — "${groupName}"`,
    wrap(`<p>Hi ${name},</p>
          <p>The admin has closed Uber Pot category proposals in <strong>${groupName}</strong>. No new categories can be proposed.</p>
          <p>Make sure you've submitted your answers for all open Uber Pot categories — they still accept entries until the deadline!</p>
          <p><a href="${APP_URL}/groups/${groupId}?tab=predictions" style="display:inline-block;background:#f59e0b;color:#111;font-weight:700;padding:10px 20px;border-radius:8px;text-decoration:none">View Uber Pot →</a></p>`),
  );
}

/** Sent when admin advances to group_active (group stage has started). */
export async function emailGroupStageStarted(
  to: string,
  name: string,
  groupName: string,
  groupId: string,
): Promise<void> {
  await send(
    to,
    `⚽ The group stage has kicked off! — ${groupName}`,
    wrap(`<p>Hi ${name},</p>
          <p>The 2026 World Cup group stage is underway! Your group stage predictions are now locked.</p>
          <p>Results appear automatically as matches finish. The top 2 from each group and the 8 best third-placed teams advance to the Round of 32.</p>
          <p><a href="${APP_URL}/groups/${groupId}?tab=standings" style="display:inline-block;background:#f59e0b;color:#111;font-weight:700;padding:10px 20px;border-radius:8px;text-decoration:none">Follow the Standings →</a></p>`),
  );
}

/** Sent when admin advances to ko_active (KO predictions locked, bracket live). */
export async function emailKOStageActive(
  to: string,
  name: string,
  groupName: string,
  groupId: string,
  leaderboard: LeaderboardRow[],
): Promise<void> {
  await send(
    to,
    `🔒 Knockout predictions locked — the bracket is live! (${groupName})`,
    wrap(`<p>Hi ${name},</p>
          <p>The knockout stage has begun in <strong>${groupName}</strong> — predictions are now locked. Here's how you stand:</p>
          ${leaderboardHtml(leaderboard)}
          <p>Follow the action as results come in!</p>
          <p><a href="${APP_URL}/groups/${groupId}?tab=standings" style="display:inline-block;background:#f59e0b;color:#111;font-weight:700;padding:10px 20px;border-radius:8px;text-decoration:none">View Bracket →</a></p>`),
  );
}

/** Sent when admin marks tournament finished. Mentions uber pot settlement still needed. */
export async function emailTournamentFinished(
  to: string,
  name: string,
  groupName: string,
  groupId: string,
  leaderboard: LeaderboardRow[],
): Promise<void> {
  await send(
    to,
    `🏆 The tournament is over! — ${groupName}`,
    wrap(`<p>Hi ${name},</p>
          <p>The 2026 World Cup is over! Here's how <strong>${groupName}</strong> currently stands:</p>
          ${leaderboardHtml(leaderboard)}
          <p style="background:#1f2937;border-left:3px solid #f59e0b;padding:10px 14px;border-radius:4px;font-size:14px">
            ⚠️ <strong>Note:</strong> The admin still needs to settle all Uber Pot categories before final earnings are confirmed. Final standings will update once that's done.
          </p>
          <p><a href="${APP_URL}/groups/${groupId}?tab=standings" style="display:inline-block;background:#f59e0b;color:#111;font-weight:700;padding:10px 20px;border-radius:8px;text-decoration:none">View Standings →</a></p>`),
  );
}

/** Admin-composed broadcast to all members of a group. */
export async function emailAdminBroadcast(
  to: string,
  name: string,
  groupName: string,
  groupId: string,
  subject: string,
  message: string,
): Promise<void> {
  await send(
    to,
    subject,
    wrap(`<p>Hi ${name},</p>
          <p style="white-space:pre-wrap">${message.replace(/\n/g, "<br>")}</p>
          <p style="margin-top:16px;font-size:12px;color:#6b7280">This message was sent by the admin of <strong>${groupName}</strong>.</p>
          <p><a href="${APP_URL}/groups/${groupId}">Open ${groupName} →</a></p>`),
  );
}
