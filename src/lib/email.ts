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
