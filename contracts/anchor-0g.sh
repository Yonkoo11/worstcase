#!/usr/bin/env bash
# Broadcast a Worstcase anchor to the 0G RunRegistry, then read it back to verify.
#
# Usage:  ./contracts/anchor-0g.sh galileo
#         ./contracts/anchor-0g.sh mainnet
#
# Run `npx vite-node scripts/anchor-run.ts <fixtureId>` first — it derives the
# anchored values from the real engine. This script only signs and broadcasts;
# the key is sourced into this subshell and every output line is redacted.

set -euo pipefail
cd "$(dirname "$0")/.."

NETWORK="${1:-}"
case "$NETWORK" in
  galileo) RPC="https://evmrpc-testnet.0g.ai"; CHAIN_ID=16602; EXPLORER="https://chainscan-galileo.0g.ai" ;;
  mainnet) RPC="https://evmrpc.0g.ai";         CHAIN_ID=16661; EXPLORER="https://chainscan.0g.ai" ;;
  *) echo "ERROR: usage: $0 <galileo|mainnet>" >&2; exit 1 ;;
esac

DEPLOYMENT="contracts/deployments/${CHAIN_ID}.json"
REQUEST="contracts/deployments/anchor-request.json"
[[ -f "$DEPLOYMENT" ]] || { echo "ERROR: $DEPLOYMENT not found. Deploy first with ./contracts/deploy-0g.sh $NETWORK" >&2; exit 2; }
[[ -f "$REQUEST" ]]    || { echo "ERROR: $REQUEST not found. Run scripts/anchor-run.ts first." >&2; exit 3; }

jsonf() { python3 -c "import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]])" "$1" "$2"; }

REGISTRY=$(jsonf "$DEPLOYMENT" runRegistry)
BUNDLE_ROOT=$(jsonf "$REQUEST" bundleRoot)
POLICY_HASH=$(jsonf "$REQUEST" policyHash)
GRAPH_HASH=$(jsonf "$REQUEST" graphHash)
MAX_LOSS=$(jsonf "$REQUEST" maximumLossBaseUnits)
ENGINE_HASH=$(jsonf "$REQUEST" engineVersionHash)
STATUS=$(jsonf "$REQUEST" status)
FIXTURE=$(jsonf "$REQUEST" fixtureId)

# shellcheck source=./lib-wallet.sh
. contracts/lib-wallet.sh
resolve_wallet || exit $?

LIVE_CHAIN_ID=$(cast chain-id --rpc-url "$RPC")
[[ "$LIVE_CHAIN_ID" == "$CHAIN_ID" ]] || { echo "ERROR: $RPC reports chain $LIVE_CHAIN_ID, expected $CHAIN_ID. Refusing to broadcast." >&2; exit 6; }

echo "Anchoring run for fixture '$FIXTURE' on 0G $NETWORK ..."
echo "  registry:    $REGISTRY"
echo "  bundleRoot:  $BUNDLE_ROOT"
echo "  maximumLoss: $MAX_LOSS base units"

# Re-running against an unchanged bundle is normal: the root is content derived,
# so an identical model produces an identical root and the registry rejects the
# duplicate. Report that as already anchored rather than dying opaquely.
EXISTING=$(cast call "$REGISTRY" "getAnchor(address,bytes32)((bytes32,bytes32,uint256,bytes32,uint8,address,uint64))" "$SIGNER_ADDRESS" "$BUNDLE_ROOT" --rpc-url "$RPC" 2>/dev/null || true)
if [[ -n "$EXISTING" && "$EXISTING" != *", 0, 0x0000000000000000000000000000000000000000,"* ]]; then
  echo "Already anchored on $NETWORK for this exact bundle root; leaving the existing record untouched."
  echo "  $EXPLORER/address/$REGISTRY"
  exit 0
fi

OUTPUT=$(cast send "$REGISTRY" \
  "anchor(bytes32,bytes32,bytes32,uint256,bytes32,uint8)" \
  "$BUNDLE_ROOT" "$POLICY_HASH" "$GRAPH_HASH" "$MAX_LOSS" "$ENGINE_HASH" "$STATUS" \
  --rpc-url "$RPC" "${WALLET_ARGS[@]}" --legacy 2>&1 | redact)

echo "$OUTPUT"
TXH=$(echo "$OUTPUT" | grep -oiE 'transactionHash\s+0x[0-9a-fA-F]{64}' | head -1 | grep -oE '0x[0-9a-fA-F]{64}')
[[ -n "$TXH" ]] || { echo "ERROR: could not parse the anchor transaction hash." >&2; exit 7; }

SUBMITTER="$SIGNER_ADDRESS"

# Read the anchor back from chain state; this is the verification step.
echo ""
echo "Reading the anchor back from 0G Chain ..."
READBACK=$(cast call "$REGISTRY" \
  "getAnchor(address,bytes32)((bytes32,bytes32,uint256,bytes32,uint8,address,uint64))" \
  "$SUBMITTER" "$BUNDLE_ROOT" --rpc-url "$RPC")
echo "$READBACK"

echo "$READBACK" | grep -qi "${MAX_LOSS}" || { echo "ERROR: on-chain maximumLoss does not match the local run." >&2; exit 8; }

cat > "contracts/deployments/${CHAIN_ID}-anchor-${FIXTURE}.json" <<JSON
{
  "network": "$NETWORK",
  "chainId": $CHAIN_ID,
  "runRegistry": "$REGISTRY",
  "submitter": "$SUBMITTER",
  "fixtureId": "$FIXTURE",
  "bundleRoot": "$BUNDLE_ROOT",
  "maximumLossBaseUnits": "$MAX_LOSS",
  "anchorTx": "$TXH",
  "explorerTx": "$EXPLORER/tx/$TXH",
  "explorerContract": "$EXPLORER/address/$REGISTRY"
}
JSON

echo ""
echo "================================================================"
echo "  Anchor confirmed on 0G $NETWORK"
echo "  Tx:       $EXPLORER/tx/$TXH"
echo "  Contract: $EXPLORER/address/$REGISTRY"
echo "  Record:   contracts/deployments/${CHAIN_ID}-anchor-${FIXTURE}.json"
echo "================================================================"
