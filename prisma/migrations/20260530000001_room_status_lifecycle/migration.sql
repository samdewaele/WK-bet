-- Add simulationMode field to Room and rename status values to new lifecycle names
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "creatorId" TEXT,
    "entryFee" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'setup',
    "simulationMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Room_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Room" ("createdAt", "creatorId", "entryFee", "id", "inviteCode", "name", "status") SELECT "createdAt", "creatorId", "entryFee", "id", "inviteCode", "name", "status" FROM "Room";
DROP TABLE "Room";
ALTER TABLE "new_Room" RENAME TO "Room";
CREATE UNIQUE INDEX "Room_inviteCode_key" ON "Room"("inviteCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Rename old status values to new lifecycle names
UPDATE "Room" SET "status" = 'betting' WHERE "status" = 'open';
UPDATE "Room" SET "status" = 'closed' WHERE "status" = 'locked';
UPDATE "Room" SET "status" = 'group_active' WHERE "status" = 'active';
