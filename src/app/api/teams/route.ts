import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teams = await db.team.findMany({
    orderBy: [{ group: "asc" }, { name: "asc" }],
    select: { id: true, name: true, flag: true, group: true },
  });

  return NextResponse.json(teams);
}
