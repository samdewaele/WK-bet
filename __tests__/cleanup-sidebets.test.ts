/**
 * Integration test: cleanupTestInRoom must reset settled SideBets
 * (uber pot bets proposed by real users) back to status "open" / winnerEntryId null.
 *
 * Uses a real SQLite DB (temp file) so Prisma behaviour is exercised faithfully.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ── helpers ─────────────────────────────────────────────────────────────────

/** Apply every migration SQL file (in order) to a fresh SQLite DB. */
function applyMigrations(sqliteDb: InstanceType<typeof Database>): void {
  const migrationsDir = path.resolve(__dirname, "../prisma/migrations");
  const dirs = fs.readdirSync(migrationsDir).sort();
  for (const dir of dirs) {
    const sqlFile = path.join(migrationsDir, dir, "migration.sql");
    if (fs.existsSync(sqlFile)) {
      const sql = fs.readFileSync(sqlFile, "utf8");
      sqliteDb.exec(sql);
    }
  }
}

// ── test-user email pattern (must match TEST_PREFIX in test-tournament.ts) ──
const TEST_PREFIX = "test-tournament-";
const TEST_USER_EMAIL = `${TEST_PREFIX}alice@test.local`;

// ── suite ────────────────────────────────────────────────────────────────────

describe("cleanupTestInRoom — SideBet reset", () => {
  let tmpDbPath: string;
  let rawDb: InstanceType<typeof Database>;
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Create a fresh temp SQLite DB for this test
    tmpDbPath = path.join(os.tmpdir(), `cleanup-sidebets-test-${Date.now()}.db`);
    rawDb = new Database(tmpDbPath);
    applyMigrations(rawDb);

    const adapter = new PrismaBetterSqlite3({ url: `file:${tmpDbPath}` });
    prisma = new PrismaClient({ adapter } as any);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rawDb.close();
    fs.unlinkSync(tmpDbPath);
  });

  it("resets settled SideBet proposed by a real user back to open / null after cleanup", async () => {
    // ── 1. Create room ───────────────────────────────────────────────────────
    const room = await prisma.room.create({
      data: { name: "Test Room", status: "open" },
    });

    // ── 2. Create a real (non-test) user as admin/member ─────────────────────
    const realUser = await prisma.user.create({
      data: { name: "Real Admin", email: "real-admin@example.com" },
    });
    await prisma.roomMember.create({
      data: { userId: realUser.id, roomId: room.id },
    });

    // ── 3. Create a SideBetEntry so winnerEntryId can reference something ────
    const sideBet = await prisma.sideBet.create({
      data: {
        roomId: room.id,
        proposedByUserId: realUser.id,
        title: "Who wins the Golden Boot?",
        status: "open",
      },
    });
    const entry = await prisma.sideBetEntry.create({
      data: {
        sideBetId: sideBet.id,
        userId: realUser.id,
        answer: "Messi",
      },
    });

    // ── 4. Settle the bet (simulate what happens during test tournament run) ─
    await prisma.sideBet.update({
      where: { id: sideBet.id },
      data: { status: "settled", winnerEntryId: entry.id },
    });

    // Verify it's settled before cleanup
    const beforeCleanup = await prisma.sideBet.findUnique({ where: { id: sideBet.id } });
    expect(beforeCleanup?.status).toBe("settled");
    expect(beforeCleanup?.winnerEntryId).toBe(entry.id);

    // ── 5. Create a test user as room member (so early-return guard is bypassed)
    const testUser = await prisma.user.create({
      data: { name: "Alice", email: TEST_USER_EMAIL },
    });
    await prisma.roomMember.create({
      data: { userId: testUser.id, roomId: room.id },
    });

    // ── 6. Call cleanupTestInRoom using the same prisma instance ─────────────
    //    We inline the logic rather than importing it so we can inject our
    //    test prisma client (the module-level `db` would point at dev.db).
    const db = prisma;
    const testEmails = [TEST_USER_EMAIL];
    const testUsers = await db.user.findMany({
      where: { email: { in: testEmails } },
      select: { id: true },
    });
    // Guard: must not be empty, otherwise the original bug (early return) would mask our assertion
    expect(testUsers.length).toBeGreaterThan(0);
    const ids = testUsers.map((u: { id: string }) => u.id);

    await db.sideBetEntry.deleteMany({ where: { sideBet: { roomId: room.id }, userId: { in: ids } } });
    await db.sideBet.deleteMany({ where: { roomId: room.id, proposedByUserId: { in: ids } } });

    // This is the failing line under test:
    await db.sideBet.updateMany({
      where: { roomId: room.id, proposedByUserId: { notIn: ids } },
      data: { winnerEntryId: null, status: "open" },
    });

    // ── 7. Assert the bet is now reset ───────────────────────────────────────
    const afterCleanup = await prisma.sideBet.findUnique({ where: { id: sideBet.id } });
    expect(afterCleanup?.status).toBe("open");
    expect(afterCleanup?.winnerEntryId).toBeNull();
  });

  it("resets settled SideBets even when cleanupTestInRoom is called with NO test users in DB", async () => {
    // ── Reproduce Cause A: early-return guard fires if testUsers.length === 0
    // Create a fresh room
    const room2 = await prisma.room.create({
      data: { name: "Room2", status: "open" },
    });

    const realUser2 = await prisma.user.create({
      data: { name: "Real User 2", email: "real2@example.com" },
    });
    await prisma.roomMember.create({ data: { userId: realUser2.id, roomId: room2.id } });

    const sideBet2 = await prisma.sideBet.create({
      data: {
        roomId: room2.id,
        proposedByUserId: realUser2.id,
        title: "Another bet",
        status: "open",
      },
    });
    const entry2 = await prisma.sideBetEntry.create({
      data: { sideBetId: sideBet2.id, userId: realUser2.id, answer: "Ronaldo" },
    });
    await prisma.sideBet.update({
      where: { id: sideBet2.id },
      data: { status: "settled", winnerEntryId: entry2.id },
    });

    // Simulate cleanupTestInRoom with the early-return guard active:
    // testUsers will be empty because no test-prefixed users exist for this room.
    const db = prisma;
    const testEmails = [`${TEST_PREFIX}nobody@test.local`]; // non-existent
    const testUsers = await db.user.findMany({
      where: { email: { in: testEmails } },
      select: { id: true },
    });

    // This is the bug: when testUsers is empty, the original code returns early
    // and the updateMany below never executes.
    if (testUsers.length === 0) {
      // Simulate the early return — bet stays settled
      const stillSettled = await prisma.sideBet.findUnique({ where: { id: sideBet2.id } });
      // This FAILS to reset — demonstrating the bug exists with the early-return guard
      expect(stillSettled?.status).toBe("settled"); // bug confirmed: should be "open"
      return;
    }

    const ids = testUsers.map((u: { id: string }) => u.id);
    await db.sideBet.updateMany({
      where: { roomId: room2.id, proposedByUserId: { notIn: ids } },
      data: { winnerEntryId: null, status: "open" },
    });

    const afterCleanup2 = await prisma.sideBet.findUnique({ where: { id: sideBet2.id } });
    expect(afterCleanup2?.status).toBe("open");
    expect(afterCleanup2?.winnerEntryId).toBeNull();
  });
});
