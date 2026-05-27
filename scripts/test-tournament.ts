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

    console.log("\n  SIMULATED MATCH RESULTS");
    sep();
    for (const m of report.matches) {
      console.log(`  ${m.homeTeam.padEnd(15)} ${m.score}  ${m.awayTeam}`);
    }

    console.log("\n  LEADERBOARD");
    sep();
    const totalPts = report.leaderboard.reduce((s, p) => s + p.points, 0);
    report.leaderboard.forEach((p, i) => {
      const share = totalPts > 0 ? (p.points / totalPts) * report.potTotal : 0;
      console.log(`  ${i + 1}. ${p.name.padEnd(25)} ${String(p.points).padStart(2)} pts  →  €${share.toFixed(2)}`);
      for (const b of p.breakdown) {
        console.log(`     ${b.matchLabel.padEnd(22)} pred ${b.predicted}  actual ${b.actual}  +${b.pts}`);
      }
    });

    const sumCheck = report.leaderboard.reduce((s, p) => {
      return s + (totalPts > 0 ? (p.points / totalPts) * report.potTotal : 0);
    }, 0);
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
