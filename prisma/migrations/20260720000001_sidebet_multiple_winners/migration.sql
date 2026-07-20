-- Support multiple winners per Uber Pot side bet (ties). Each winning entry is
-- flagged; on settle the bet's share of the pot is split across the flagged
-- winners. Existing settled bets are backfilled from SideBet.winnerEntryId.
ALTER TABLE "SideBetEntry" ADD COLUMN "isWinner" BOOLEAN NOT NULL DEFAULT false;

UPDATE "SideBetEntry"
SET "isWinner" = true
WHERE "id" IN (SELECT "winnerEntryId" FROM "SideBet" WHERE "winnerEntryId" IS NOT NULL);
