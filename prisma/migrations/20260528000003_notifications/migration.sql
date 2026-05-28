CREATE TABLE "Notification" (
    "id"     TEXT NOT NULL PRIMARY KEY,
    "type"   TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Notification_type_key" ON "Notification"("type");
