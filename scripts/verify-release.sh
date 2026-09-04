#!/usr/bin/env bash
# Pre-release checks for the failures that were silent rather than loud.
#
#   ./scripts/verify-release.sh            # local gates
#   ./scripts/verify-release.sh --deployed # also confirm the live site serves THIS build
#
# Each check exists because the corresponding failure actually happened.

set -uo pipefail
cd "$(dirname "$0")/.."
# This machine keeps node 22 outside the default PATH; CI and other machines do not.
[ -d /opt/homebrew/opt/node@22/bin ] && export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
FAILED=0
step() { printf '\n== %s\n' "$1"; }
ok()   { printf '   ok   %s\n' "$1"; }
bad()  { printf '   FAIL %s\n' "$1"; FAILED=1; }

# 1. Lockfile parity with CI.
# `npm install` tolerates drift, `npm ci` does not. Verifying with install while CI
# ran ci meant the deploy failed for two commits while local checks stayed green.
step "lockfile is in sync with CI (npm ci)"
if npm ci --dry-run >/dev/null 2>&1; then ok "npm ci resolves"; else bad "npm ci would fail — run npm install and commit the lockfile"; fi

step "typecheck, tests, contracts"
npm run typecheck >/dev/null 2>&1 && ok "tsc clean" || bad "typecheck"
npm test >/dev/null 2>&1 && ok "vitest suite" || bad "vitest suite"
forge test --offline >/dev/null 2>&1 && ok "foundry suite" || bad "foundry suite"

step "dependency and secret posture"
if npm audit --json 2>/dev/null | python3 -c 'import sys,json;sys.exit(0 if json.load(sys.stdin)["metadata"]["vulnerabilities"]["total"]==0 else 1)'; then
  ok "npm audit reports zero advisories"
else bad "npm audit is no longer zero — the Storage SDK admission is conditional on this"; fi
node scripts/verify-secrets.mjs >/dev/null 2>&1 && ok "no secret-shaped values in public files" || bad "secret scan"

# 2. Deployed build identity.
# A 200 from the site proves it is reachable, not that it serves the current build.
# The redesign sat undeployed behind a green-looking 200 for two commits.
if [[ "${1:-}" == "--deployed" ]]; then
  step "the live site serves THIS build"
  WORSTCASE_BASE=/worstcase/ npm run build:web >/dev/null 2>&1
  LOCAL_ASSET=$(find dist/web/assets -name 'index-*.js' -exec basename {} \; | head -1)
  LIVE_HTML=$(curl -s -m 25 "https://yonkoo11.github.io/worstcase/?cachebust=$RANDOM")
  if [[ -z "$LOCAL_ASSET" ]]; then bad "no local build asset to compare"
  elif grep -q "$LOCAL_ASSET" <<<"$LIVE_HTML"; then ok "live site references $LOCAL_ASSET"
  else bad "live site does NOT serve $LOCAL_ASSET — the deploy has not landed"; fi
fi

printf '\n'
if [[ $FAILED -eq 0 ]]; then echo "verify-release: all checks passed"; else echo "verify-release: FAILURES above"; fi
exit $FAILED
