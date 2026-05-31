#!/bin/bash
set -euo pipefail

# Run async so the session starts immediately while deps install in background
echo '{"async": true, "asyncTimeout": 300000}'

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Install npm dependencies (uses cache after first run)
npm install

# Generate Prisma client
npx prisma generate

# Install Playwright browser (needed for E2E tests).
# Failure here is non-fatal — browsers may already be cached or the
# network may not allow downloads in this environment.
npx playwright install --with-deps chromium 2>/dev/null || \
  npx playwright install chromium 2>/dev/null || \
  echo "Playwright browser install skipped (network unavailable — will work in CI)"
