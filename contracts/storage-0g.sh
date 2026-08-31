#!/usr/bin/env bash
# Upload Worstcase evidence bundles to 0G Storage and verify the round trip.
#
# Usage:  ./contracts/storage-0g.sh galileo [bundle.json ...]
#         with no bundle arguments it uploads every bundle in evidence/.
#
# The signing key is sourced into this subshell and handed to Node through the
# process environment only. It is never read from a file by the TypeScript, never
# printed, and every line of output passes through a redactor.

set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

NETWORK="${1:-galileo}"
shift || true
[[ "$NETWORK" == "galileo" ]] || { echo "ERROR: only 'galileo' is supported for storage today." >&2; exit 1; }

# shellcheck source=./lib-wallet.sh
. contracts/lib-wallet.sh
resolve_wallet || exit $?
[[ -n "${PRIVATE_KEY:-}" ]] || { echo "ERROR: 0G Storage needs PRIVATE_KEY in the environment; a keystore account cannot be used here yet." >&2; exit 2; }
export PRIVATE_KEY

BUNDLES=("$@")
if [[ ${#BUNDLES[@]} -eq 0 ]]; then
  while IFS= read -r f; do BUNDLES+=("$f"); done < <(find evidence -name '0x*.json' | sort)
fi

for BUNDLE in "${BUNDLES[@]}"; do
  echo ""
  echo "### $BUNDLE"
  npx vite-node scripts/storage-upload.ts "$NETWORK" "$BUNDLE" 2>&1 | redact | sed 's/^/    /'
done
