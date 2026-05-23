#!/bin/sh
set -e

# Ensure the volume directory exists (Fly mounts /data)
mkdir -p /data

echo "→ Running database migrations..."
npx prisma migrate deploy

echo "→ Checking seed data..."
npx tsx prisma/seed.ts

echo "→ Starting server on port ${PORT:-3000}..."
exec node_modules/.bin/next start -p "${PORT:-3000}"
