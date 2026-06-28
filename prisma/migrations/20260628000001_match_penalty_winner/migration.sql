-- Add the actual shootout winner side for KO matches level after full/extra time.
ALTER TABLE "Match" ADD COLUMN "penaltyWinner" TEXT;
