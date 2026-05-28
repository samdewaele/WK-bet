/**
 * CLI wrapper around the test tournament lib.
 *
 * Run with:
 *   npm run test:tournament
 */

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import path from "path";
import { runTestTournament, cleanupTestTournament } from "../src/lib/test-tournament";

function sep(char = "─", width = 70) { console.log(char.repeat(width)); }
function header(t: string) { sep("═"); console.log(`  ${t}`); sep("═"); }

async function main() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const filePath = url.replace(/^file:/, "");
  const dbPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  const db = new PrismaClient({ adapter } as any);
  // Inject into the global so src/lib/db.ts singleton picks it up
  (global as any).prisma = db;

  header("TEST TOURNAMENT — WK-Bet 2026 (CLI)");

  try {
    console.log("\nRunning test tournament…");
    const report = await runTestTournament();

    header("RESULTS");

    console.log("\n  LEADERBOARD");
    sep();
    report.leaderboard.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name.padEnd(25)} ${String(p.points).padStart(3)} pts  →  €${p.earned.toFixed(2)}`);
    });

    const sumCheck = report.leaderboard.reduce((s, p) => s + p.earned, 0);
    console.log();
    sep("-");
    console.log(`  Pot total: €${report.potTotal.toFixed(2)}   Distributed: €${sumCheck.toFixed(2)}   ${Math.abs(sumCheck - report.potTotal) < 0.01 ? "✓ OK" : "✗ MISMATCH"}`);

    console.log("\n\nCleaning up…");
    await cleanupTestTournament();
    console.log("  ✓ Done");

    sep("═");
    console.log("  Complete.");
    sep("═");
  } catch (err) {
    console.error("\n[ERROR]", err);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

main();
