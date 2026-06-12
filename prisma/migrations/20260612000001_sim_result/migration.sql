-- CreateTable
CREATE TABLE "SimResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "homeTeamId" TEXT,
    "awayTeamId" TEXT,
    CONSTRAINT "SimResult_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SimResult_matchId_key" ON "SimResult"("matchId");
