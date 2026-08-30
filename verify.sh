#!/usr/bin/env bash

# This contract starts RED until implementation evidence exists. That is correct.
# Never weaken, skip, or special-case a predicate to manufacture a pass.
# Verification must use scratch space and leave tracked files unchanged.

set -u
phase="${1:-all}"
case "$phase" in
  all|phase-0|phase-1|phase-2|phase-3|phase-4|phase-5) ;;
  *) echo "Usage: ./verify.sh [all|phase-0|phase-1|phase-2|phase-3|phase-4|phase-5]"; exit 2 ;;
esac

failures=0
checks=0

run_check() {
  local label="$1"; shift; checks=$((checks + 1))
  if "$@"; then echo "PASS: $label"; else echo "FAIL: $label"; failures=$((failures + 1)); fi
}

run_npm() {
  local script="$1"
  [[ -f package.json ]] || return 1
  python3 -c 'import os, subprocess, sys
try:
    result = subprocess.run(["npm", "run", sys.argv[1]], timeout=int(os.environ.get("VERIFY_TIMEOUT_SECONDS", "300")))
except subprocess.TimeoutExpired:
    print(f"verification timed out: {sys.argv[1]}", file=sys.stderr)
    raise SystemExit(124)
raise SystemExit(result.returncode)' "$script"
}

run_phase_0() {
  run_check "versioned domain contracts" run_npm verify:contracts
  run_check "finite-model semantics" run_npm verify:model-semantics
  run_check "threat model and sandbox contract" run_npm verify:threat-model
  run_check "fixed fixtures and oracle" run_npm verify:fixtures
  run_check "tracked-secret and private-file gate" run_npm verify:secrets
}
run_phase_1() {
  run_check "exact Phase 1 oracle" run_npm test:phase1
  run_check "deterministic compiler and checker" run_npm test:determinism
  run_check "counterexample minimality" run_npm test:counterexample
  run_check "unknown and truncation behavior" run_npm test:unknown
  run_check "synthetic side-effect isolation" run_npm test:sandbox
}
run_phase_2() {
  run_check "real 0G Compute probe" run_npm verify:zerog:compute:live
  run_check "real 0G Storage round trip and proof" run_npm verify:zerog:storage:live
  run_check "RunRegistry unit and invariant suite" run_npm test:registry
  run_check "approved 0G Chain anchor" run_npm verify:zerog:chain:live
  run_check "canonical replay reconstruction" run_npm test:replay
  run_check "sponsor failure boundaries" run_npm test:zerog:failures
}
run_phase_3() {
  run_check "selected brand record and assets" run_npm verify:brand
  run_check "three proposals and selected direction" run_npm verify:design-selection
  run_check "core browser journey" run_npm test:e2e:core
  run_check "accessible keyboard journey" run_npm test:a11y
  run_check "responsive states and visual regression" run_npm test:visual
}
run_phase_4() {
  run_check "oracle and property suite" run_npm test:soundness
  run_check "release build and full tests" run_npm verify:release
  run_check "security and dependency gates" run_npm verify:security
  run_check "bounded performance" run_npm verify:performance
  run_check "observability and planted failures" run_npm verify:operations
  run_check "repository and documentation" run_npm verify:repository
}
run_phase_5() {
  run_check "live no-login judge journey" run_npm verify:live
  run_check "live sponsor evidence manifest" run_npm verify:sponsor-depth
  run_check "telemetry redaction" run_npm verify:live-redaction
  run_check "demo artifact and duration" run_npm verify:demo
  run_check "submission package and judge guide" run_npm verify:submission
}

case "$phase" in
  phase-0) run_phase_0 ;; phase-1) run_phase_1 ;; phase-2) run_phase_2 ;;
  phase-3) run_phase_3 ;; phase-4) run_phase_4 ;; phase-5) run_phase_5 ;;
  all) run_phase_0; run_phase_1; run_phase_2; run_phase_3; run_phase_4; run_phase_5 ;;
esac

echo
echo "Manual checks (never auto-passed):"
echo "- One of exactly three original marks was selected before derived assets."
echo "- One of exactly three rendered interface proposals, or an explicit hybrid, was selected before UI implementation."
echo "- The result hierarchy and assumptions are understandable without narration."
echo "- Live, replayed, mocked, synthetic, testnet, pending, unknown, and failed states are labeled truthfully."
echo "- The demo and submission reveal no secrets, private evidence, or uncontrolled payloads."
echo "- Every outward action received its required approval."

if (( failures > 0 )); then
  echo; echo "RESULT: FAIL ($failures of $checks automated checks failed)"; exit 1
fi
echo; echo "RESULT: PASS ($checks automated checks passed; manual checks still require evidence)"
