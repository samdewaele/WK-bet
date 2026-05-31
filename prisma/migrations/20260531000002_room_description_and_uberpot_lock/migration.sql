-- Add optional group description and admin-controlled uber-pot lock to Room
ALTER TABLE "Room" ADD COLUMN "description" TEXT;
ALTER TABLE "Room" ADD COLUMN "uberBetsLocked" BOOLEAN NOT NULL DEFAULT false;
