#!/bin/bash
# Cmail — full-cycle security E2E: wipe local D1, boot wrangler dev, run the matrix
set -e
cd "$(dirname "$0")/.."
pkill -f "wrangler dev" 2>/dev/null || true
sleep 2
rm -rf .wrangler/state
npx wrangler dev --port 8787 > /tmp/wrangler-dev.log 2>&1 &
for i in $(seq 1 30); do
  curl -s -o /dev/null http://127.0.0.1:8787/api/health && break
  sleep 1
done
node scripts/test-security.mjs
