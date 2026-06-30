-- Store the penalty shootout score so it can be shown alongside the level result.
ALTER TABLE "Match" ADD COLUMN "penaltyHome" INTEGER;
ALTER TABLE "Match" ADD COLUMN "penaltyAway" INTEGER;
