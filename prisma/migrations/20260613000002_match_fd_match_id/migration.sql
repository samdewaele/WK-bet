-- Add football-data.org numeric match ID as the primary sync key.
-- Nullable so existing rows survive the migration; populated by seed.ts on next deploy.
ALTER TABLE "Match" ADD COLUMN "fdMatchId" INTEGER;
CREATE UNIQUE INDEX "Match_fdMatchId_key" ON "Match"("fdMatchId");
