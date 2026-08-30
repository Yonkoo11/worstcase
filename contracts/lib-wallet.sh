# Shared wallet resolution for the Worstcase 0G scripts. Source, do not execute.
#
# Two ways to supply the signer, in order of preference:
#
#   1. Encrypted Foundry keystore (preferred). The key never appears in argv,
#      in shell history, or in any plaintext file on disk:
#         cast wallet import worstcase --interactive     # once
#         export ETH_KEYSTORE_ACCOUNT=worstcase
#      Foundry prompts for the password, or reads ETH_PASSWORD / --password-file.
#
#   2. Plaintext env file holding PRIVATE_KEY=0x… (fallback). Convenient, but the
#      key is passed to forge/cast as a command-line argument, which is visible to
#      other processes on the same machine via `ps`. Acceptable for a throwaway
#      testnet key; do not use it for a mainnet key that holds real value.
#
# Sets: WALLET_ARGS (array), SIGNER_ADDRESS, and a `redact` function.

resolve_wallet() {
  WALLET_ARGS=()
  PRIVATE_KEY="${PRIVATE_KEY:-}"

  if [[ -n "${ETH_KEYSTORE_ACCOUNT:-}" ]]; then
    WALLET_ARGS=(--account "$ETH_KEYSTORE_ACCOUNT")
    SIGNER_ADDRESS=$(cast wallet address "${WALLET_ARGS[@]}")
    echo "Signer: keystore account '$ETH_KEYSTORE_ACCOUNT' ($SIGNER_ADDRESS)"
    return 0
  fi

  local env_file="${WORSTCASE_ENV_FILE:-contracts/.env}"
  if [[ ! -f "$env_file" ]]; then
    echo "ERROR: no signer available." >&2
    echo "  Preferred: cast wallet import worstcase --interactive && export ETH_KEYSTORE_ACCOUNT=worstcase" >&2
    echo "  Fallback:  create '$env_file' containing PRIVATE_KEY=0x<64 hex chars>" >&2
    return 2
  fi

  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a

  if ! [[ "${PRIVATE_KEY:-}" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
    echo "ERROR: PRIVATE_KEY missing or malformed in '$env_file' (need 0x + 64 hex)." >&2
    return 3
  fi

  WALLET_ARGS=(--private-key "$PRIVATE_KEY")
  SIGNER_ADDRESS=$(cast wallet address --private-key "$PRIVATE_KEY")
  echo "Signer: $SIGNER_ADDRESS (from $env_file)"
  echo "NOTE: this path passes the key in argv, visible via \`ps\`. Prefer a keystore for anything holding real value."
  return 0
}

# Belt-and-braces guard against a key reaching the terminal through tool output.
redact() {
  if [[ -z "${PRIVATE_KEY:-}" ]]; then cat; return; fi
  python3 -c '
import sys
key = "'"${PRIVATE_KEY}"'"
short = key[:6] + "..." + key[-4:]
for line in sys.stdin:
    sys.stdout.write(line.replace(key, "<PRIVATE_KEY:" + short + ">"))
'
}
