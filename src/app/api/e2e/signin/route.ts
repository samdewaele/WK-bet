import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { randomUUID } from "crypto";

/**
 * Test-only endpoint: creates a user + DB session, sets the session cookie
 * via Set-Cookie header, and redirects to /groups.
 *
 * Using a GET + redirect so the browser handles the cookie natively —
 * this is more reliable than Playwright's addCookies() across versions.
 *
 * Only active when E2E_TEST=true; returns 404 in all other environments.
 */
export async function GET(req: Request) {
  if (process.env.E2E_TEST !== "true") {
    return new NextResponse(null, { status: 404 });
  }

  const url = new URL(req.url);
  const email = url.searchParams.get("email") ?? "e2e@test.local";
  const name = url.searchParams.get("name") ?? "Test User";
  const role = url.searchParams.get("role") ?? "user";
  const callbackUrl = url.searchParams.get("callbackUrl") ?? "/groups";

  const user = await db.user.upsert({
    where: { email },
    update: { name, role },
    create: { email, name, role },
  });

  const sessionToken = randomUUID();
  await db.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  const response = NextResponse.redirect(new URL(callbackUrl, req.url));
  response.cookies.set("authjs.session-token", sessionToken, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return response;
}
