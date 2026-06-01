-- Add optional base64 group image (small avatar) to Room
ALTER TABLE "Room" ADD COLUMN "image" TEXT;
