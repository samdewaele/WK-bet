ALTER TABLE "SideBet" ADD COLUMN "proposedByUserId" TEXT;
UPDATE "SideBet" SET "status" = 'open' WHERE "status" = 'open';
