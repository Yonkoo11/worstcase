# Adversarial review — 2026-09-02 / 2026-09-03

Reviewed as a hostile senior developer and as a hackathon judge who will click every link and run every documented command. Recorded here so the claims in the README can be checked against what was actually done.

## Automated

| Tool | Result |
|---|---|
| `semgrep --config=p/security-audit --config=p/javascript` over `packages`, `scripts`, `apps` | **0 findings** at ERROR and WARNING |
| `npm audit` | **0 advisories** across 180 packages |
| `tsc --noEmit`, strict with `exactOptionalPropertyTypes` | clean |
| `npm test` / `forge test --offline` | 127 TypeScript across 16 files, 5 Solidity |
| CodeRabbit CLI | **not run** — requires an interactive `coderabbit auth login`. Stated rather than skipped quietly. |

## Findings, all fixed

**1. A single request could burn ~36s of CPU and ~680MB of RSS.** (High)

Measured, not assumed: a 20-action manifest with the schema's maximum limits explored 1,000,001 states in 35.8 seconds at 680 MB RSS. A rate limit does not contain this, because the whole cost sits inside one request. The API now carries its own ceiling (default 50k states, 5s, depth 32) below the schema maxima, which exist for a local operator on their own machine.

Exceeding the ceiling is **refused, not clamped**. Quietly shrinking the budget would change what the returned bound covers while still calling it a bound, which is the exact failure this project exists to catch.

**2. The first version of that fix rejected callers for limits they never set.** (Medium)

With only `maxStates` supplied, the remaining values fell back to the library defaults, which exceed the server ceiling, so a valid request was refused. Caught by its own test. The server now derives its defaults by holding the library's down to the ceiling, and judges only what the caller actually asked for.

**3. Unbounded caches.** (Medium) The compiled-model map grew forever as distinct manifests arrived. Now bounded with insertion-ordered eviction.

**4. `INTERNAL` was returned but not declared** in the spec's error enum, so a client reading the contract could meet a code it had no way to anticipate. Declared.

**5. Exploration limits arrived unvalidated** and went straight to the compiler. `LIMIT_OUT_OF_RANGE` was declared in the spec and never returned by anything. Now range-checked.

**6. Stale claims in the docs.** The README advertised 115 tests over 15 files (actual: 127 over 16) and "zero across 131 packages" (actual: 180). The submission package still stated that **0G Storage is not live**, which had been false since the Storage integration landed. All corrected against measured values.

**7. Dead code kept the old, understating checker reachable.** `replayDeclaredTrajectories` was exported and never called. Deleted.

**8. The evidence bundle asserted a provenance it did not have.** `acceptedCandidateHashes` held the fixture's declared paths, which stopped driving the result once the checker began searching, and nothing re-derived it on replay. It now holds the trajectory the search accepted, and replay recomputes it.

## Judge simulation

Cloned the public repository into an empty directory and ran only what the README documents:

- `npm install` → 182 packages, `npm audit` → 0 advisories
- `npm test` → 127 passed; `forge test --offline` → 5 passed; `npm run typecheck` → clean
- Both documented CLI examples reproduced their documented output exactly (45.00 USDC, then 0 after the policy fix)
- The README's `cast call` verification command, run verbatim, returned `27500000`
- **All 14 transaction links in the README resolve on chain with success status**
- **No drift:** for all 7 fixtures, the value anchored on 0G Chain equals what the freshly cloned checkout computes today

## Open, and deliberately so

- **0G Compute stays out.** 273 packages and 5 low advisories that do not clear at any version (`elliptic`, `fixAvailable: false`), plus the unchanged behavioural blocker.
- **Testnet, not mainnet.** The deployer holds 0.0 0G on chain 16661.
- **The hosted API's records are per-instance.** A serverless filesystem is ephemeral, so the hosted deployment is a try-it-out surface, not a system of record. Run the server yourself with `WORSTCASE_DATA_DIR` on a real disk for durable records.
- **The public deployment runs with no API keys**, deliberately, so judges can try it. It is rate limited, budget capped, and cannot perform outward writes.
