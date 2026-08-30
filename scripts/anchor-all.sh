#!/usr/bin/env bash
# Anchor every Worstcase fixture result on 0G Chain, one transaction per fixture.
# Each anchor is derived from a real engine run and verified by reading it back.
set -euo pipefail
cd "$(dirname "$0")/.."
NETWORK="${1:-galileo}"
for FIXTURE in prompt-injection recipient-swap replay concurrency recursive-tool clean policy-fix; do
  echo ""
  echo "### $FIXTURE"
  npx vite-node scripts/anchor-run.ts "$FIXTURE" | sed 's/^/    /'
  ./contracts/anchor-0g.sh "$NETWORK" 2>&1 | grep -E "Tx:|maximumLoss:|ERROR|already|Already" | sed 's/^/    /' || true
done
