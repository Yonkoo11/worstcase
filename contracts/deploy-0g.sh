#!/usr/bin/env bash
# Deploy the Worstcase RunRegistry to a 0G network.
#
# Usage:  ./contracts/deploy-0g.sh galileo
#         ./contracts/deploy-0g.sh mainnet
#
# Key handling (mirrors the reviewed Sworn pattern):
#   1. An env file is sourced into THIS subshell only; the key never leaves bash.
#   2. PRIVATE_KEY is validated as 0x + 64 hex before use.
#   3. Every line of forge output passes through a redactor before printing.
#   4. Only the deployed address and explorer URL are echoed.
#
# The env file defaults to contracts/.env and can be overridden:
#   WORSTCASE_ENV_FILE=/path/to/.env ./contracts/deploy-0g.sh galileo

set -euo pipefail
cd "$(dirname "$0")/.."

NETWORK="${1:-}"
case "$NETWORK" in
  galileo) RPC="https://evmrpc-testnet.0g.ai"; CHAIN_ID=16602; EXPLORER="https://chainscan-galileo.0g.ai" ;;
  mainnet) RPC="https://evmrpc.0g.ai";         CHAIN_ID=16661; EXPLORER="https://chainscan.0g.ai" ;;
  *) echo "ERROR: usage: $0 <galileo|mainnet>" >&2; exit 1 ;;
esac

# shellcheck source=./lib-wallet.sh
. contracts/lib-wallet.sh
resolve_wallet || exit $?

# Confirm the RPC really is the network we think it is before broadcasting.
LIVE_CHAIN_ID=$(cast chain-id --rpc-url "$RPC")
if [[ "$LIVE_CHAIN_ID" != "$CHAIN_ID" ]]; then
  echo "ERROR: $RPC reports chain $LIVE_CHAIN_ID, expected $CHAIN_ID. Refusing to broadcast." >&2
  exit 5
fi

echo "Deploying RunRegistry to 0G $NETWORK (chain $CHAIN_ID) via $RPC ..."

OUTPUT=$(forge create contracts/src/RunRegistry.sol:RunRegistry \
  --rpc-url "$RPC" \
  "${WALLET_ARGS[@]}" \
  --broadcast \
  --legacy 2>&1 | redact)

echo "$OUTPUT"

ADDR=$(echo "$OUTPUT" | grep -oE 'Deployed to: 0x[0-9a-fA-F]{40}' | head -1 | awk '{print $3}')
TXH=$(echo "$OUTPUT" | grep -oE 'Transaction hash: 0x[0-9a-fA-F]{64}' | head -1 | awk '{print $3}')

if [[ -z "$ADDR" ]]; then
  echo "ERROR: could not parse the deployed address from forge output." >&2
  exit 6
fi

DEPLOYER="$SIGNER_ADDRESS"
mkdir -p contracts/deployments
cat > "contracts/deployments/${CHAIN_ID}.json" <<JSON
{
  "network": "$NETWORK",
  "chainId": $CHAIN_ID,
  "runRegistry": "$ADDR",
  "deployer": "$DEPLOYER",
  "deployTx": "$TXH",
  "rpcUrl": "$RPC",
  "explorer": "$EXPLORER"
}
JSON

echo ""
echo "================================================================"
echo "  Worstcase RunRegistry deployed on 0G $NETWORK"
echo "  Address:  $ADDR"
echo "  Explorer: $EXPLORER/address/$ADDR"
echo "  Record:   contracts/deployments/${CHAIN_ID}.json"
echo "================================================================"
