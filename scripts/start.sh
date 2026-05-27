#!/bin/sh
set -e

# Ensure the volume directory exists (Fly mounts /data)
mkdir -p /data

echo "→ Running database migrations..."
npx prisma migrate deploy

# Seed in the background — it's idempotent and skips if data already exists.
# Running it after migrations ensures schema is ready; Next.js starts in parallel.
echo "→ Seeding database (background)..."
npx tsx prisma/seed.ts &

echo "→ Starting server on port ${PORT:-3000}..."
exec node_modules/.bin/next start -p "${PORT:-3000}"
