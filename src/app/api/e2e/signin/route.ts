import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { randomUUID } from "crypto";

/**
 * Test-only endpoint: creates (or reuses) a user + DB session so Playwright
 * can authenticate without Google OAuth.  Only active when E2E_TEST=true.
 */
export async function POST(req: Request) {
  if (process.env.E2E_TEST !== "true") {
    return new NextResponse(null, { status: 404 });
  }

  const { email, name, role = "user" } = await req.json();

  const user = await db.user.upsert({
    where: { email },
    update: {},
    create: { email, name: name ?? "Test User", role },
  });

  const sessionToken = randomUUID();
  await db.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  return NextResponse.json({ sessionToken, userId: user.id });
}
