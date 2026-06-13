#!/usr/bin/env bash
# Pre-push hook: runs type-check + unit tests before allowing push.
# E2E tests are excluded (require a running server).
set -e

echo "▶ Type-checking..."
npx tsc --noEmit

echo "▶ Running unit tests..."
npm test

echo "✓ All checks passed — pushing."
