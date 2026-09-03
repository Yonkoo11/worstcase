# Worstcase

**Know the worst-case spend before you fund the agent.**

Worstcase is a pre-funding economic model checker for AI agents that hold payment-capable tools. It compiles an MCP tool manifest and a spending policy into a finite state graph, explores the reachable states, and returns two things: the **maximum amount of money the agent can lose**, and the **shortest concrete sequence of calls that loses it**.

A deterministic checker computes that number. Not a language model, and not a risk score out of 100.

Submitted to **0G Bridge by AKINDO, Wave 3**.

---

## Live on 0G

Every result below was produced by the engine in this repository, then anchored on 0G Chain and stored on 0G Storage. Each one was read back from the network and re-verified before it was recorded here.

| | |
|---|---|
| **Live interface** | https://yonkoo11.github.io/worstcase/ |
| **RunRegistry contract** | [`0xDeA0792cEc959CE6893C24dEeFc6FE9B047a3Ea3`](https://chainscan-galileo.0g.ai/address/0xDeA0792cEc959CE6893C24dEeFc6FE9B047a3Ea3) |
| **Network** | 0G Galileo, chain ID 16602 |
| **Deployment transaction** | [`0x9650db24…b25c4eea`](https://chainscan-galileo.0g.ai/tx/0x9650db244cdea86899f2a4f2736aa5ddbe547994c711174679e4da92b25c4eea) |

### The seven anchored runs

Five planted attacks, one clean baseline, and the same drain re-checked after a one-line policy fix. Each fixture is its own small agent, so the family it plants is the binding constraint rather than an artifact of which path someone wrote down. Amounts are in base units of a 6-decimal stablecoin, so `27500000` is $27.50.

| Fixture | What it plants | Max loss found | On-chain anchor |
|---|---|---|---|
| `prompt-injection` | Hostile tool output proposes an extra transfer | 27,500,000 | [tx](https://chainscan-galileo.0g.ai/tx/0x0486f8f9b431b17bda6361bf144c6c88fd51ef94ab482dd294f8a53f81fa96c8) |
| `recipient-swap` | Mutable recipient field redirects a valid amount | 25,000,000 | [tx](https://chainscan-galileo.0g.ai/tx/0x3f71b07726d3b73990798dc2d3433fc2b59bf262a14304a4a79c313f184e99d1) |
| `replay` | A signed intent is submitted more than once | 20,000,000 | [tx](https://chainscan-galileo.0g.ai/tx/0x7af36d1ff96f458ca1c47baa17232866adf9229c78b844f020c90cc6fe8cbc7c) |
| `concurrency` | Parallel calls each pass a per-call cap | 60,000,000 | [tx](https://chainscan-galileo.0g.ai/tx/0xdb34f5316891f92b5f28d285dba0f6cd5cfaa8b2cc36d8bd0d520ed5c8b5dcb4) |
| `recursive-tool` | A paid tool calls itself through a budget gap | 40,000,000 | [tx](https://chainscan-galileo.0g.ai/tx/0x173c8b5074f14d5f30aad53840df74ee0fc7e71c8864a04d05fcd2a06e52da4d) |
| `clean` | Nothing. This is the false-positive check | **0** | [tx](https://chainscan-galileo.0g.ai/tx/0xe7c0d280dc9882679fb4819b0e5eebee9a02f83f8d7dc4a9691b406b0e073260) |
| `policy-fix` | The drain, after tightening one policy edge | **0** | [tx](https://chainscan-galileo.0g.ai/tx/0x40dd36085d9656dfcf6e3ce4c2ac28b69fa7e92b552639d92c9483dedd2e6c80) |

The last two rows are the point. A checker that flags everything is useless, and a checker you cannot act on is also useless. `clean` returns zero, and `policy-fix` shows a real drain going to zero after a specific, named change.

### The same seven bundles on 0G Storage

Each evidence bundle was uploaded, then downloaded back and re-derived to the same Merkle root before the upload was recorded. Records live in `contracts/deployments/16602-storage-*.json`.

| Fixture | Storage root | Upload |
|---|---|---|
| `prompt-injection` | `0xf279c280…e728d63f` | [tx](https://chainscan-galileo.0g.ai/tx/0x68efe97a73dd75af6a13cd0d6deadbd96c24c07260771708361b5b9e4dbc3dc1) |
| `recipient-swap` | `0xbd2352f1…bb099e72` | [tx](https://chainscan-galileo.0g.ai/tx/0xca6891009f2924ec1c3615e9c204ac1e4dd706311ac5971933aa725f51e81500) |
| `replay` | `0x45020784…91cd3000` | already stored, no new transaction |
| `concurrency` | `0x8e8f90c9…99d3f8ef` | [tx](https://chainscan-galileo.0g.ai/tx/0xfcd1f01fcf3ae1d017b344107c9428e83e5cba28469b25eabf023cf10f9d2ead) |
| `recursive-tool` | `0x4f75b38c…70f2689b` | [tx](https://chainscan-galileo.0g.ai/tx/0xe88c18f272da7d3299f76c13d8b85f21e0e249f391d41fcc85fcc55b75f7f890) |
| `clean` | `0x9d5fc590…0083ca70` | [tx](https://chainscan-galileo.0g.ai/tx/0x999a707a5f13a499b28e3c2af796a4da9d584b7ceb73252c915441da47edd441) |
| `policy-fix` | `0x19cc4ac3…a79e7714` | [tx](https://chainscan-galileo.0g.ai/tx/0xfb100ab2bf91de5b1350c3c22473a65f0583a41f9fd28fb2468065967ef29ad7) |

The `replay` row is worth reading rather than skipping. 0G Storage is content addressed, so re-uploading identical bytes creates no transaction, and that bundle was unchanged by the last engine correction. The interface reports it as "stored and re-verified" with no transaction link, instead of linking a transaction that does not exist. A test enforces that distinction.

---

## The problem

Give an agent a wallet and a set of tools and you have created a spending program whose control flow is decided at runtime by a model. The usual answers are per-call limits and human approval prompts. Neither tells you the number you actually want before you fund the thing:

> If everything goes wrong at once, how much can leave this wallet?

Per-call caps do not compose. Five calls that each pass a $20 cap can still drain $60 if they run concurrently, which is exactly what the `concurrency` fixture demonstrates. A single-step guard cannot see a multi-step path.

## What Worstcase does

1. **Compile.** An MCP manifest plus a spending policy become a finite state graph. Anything the compiler does not model is rejected loudly rather than silently ignored.
2. **Check.** Breadth-first enumeration of the reachable economic states finds the greatest loss any of them realises, and the shortest path that reaches it. States are deduplicated by their economic position, so orderings of the same spends collapse instead of exploding.
3. **Explain.** Output is a concrete counterexample: an ordered list of tool calls, plus the policy checks that blocked the alternatives.
4. **Anchor.** The run is hashed into a canonical evidence bundle and recorded on 0G Chain, so the bound is bound to an exact model version and cannot be quietly restated later.

Truncated search, an unsupported action, or a timeout produce `UNKNOWN`. Never "safe". This is the property most tools in this space get wrong: absence of a finding is reported as a pass.

If the search is cut short it returns `UNKNOWN` rather than the best value found so far, because a partial maximum understates the bound, and understating it is the one error this tool must not make.

### What the search assumes

Worth stating, because a bound is only meaningful with its assumptions attached:

- **A manifest action is one intent, not an unlimited tool.** `replay-one` and `replay-two` exist as separate entries precisely because each is a single submission. Repetition that is real is modelled explicitly by `recurse` and `spawn`.
- **Policy counters can be raced; balances cannot.** A spawned child checks caps against the pre-spawn snapshot, which is the genuine time-of-check race. Settlement is still checked against the live balance, so the search cannot report losing more money than the wallet holds.
- **The bound covers the declared model within the declared limits.** It is not a proof about an arbitrary agent, and every result carries the `graphHash` and `policyHash` it was computed against.

---

## Run it on your own agent

The fixtures are examples, not the product. Point it at your own manifest and spending policy:

```bash
npx vite-node scripts/check-agent.ts \
  --manifest examples/agent-manifest.json \
  --policy   examples/spend-policy.json \
  --adversarial unknown-vendor
```

```
Maximum loss:  45000000 base units (45.00 USDC)
Explored:      8 reachable states
Shortest path: pay-unknown-vendor
```

Remove `unknown-vendor` from `allowedRecipients` and run it again with `examples/spend-policy-fixed.json`:

```
Maximum loss:  0 base units (0.00 USDC)
Shortest path: (none — no adversarial recipient is reachable)
Blocked by policy:
  pay-unknown-vendor       recipient-not-allowed
```

Exit codes are meant for CI: `0` no reachable loss, `1` a loss is reachable, `2` `UNKNOWN`, `3` the model would not compile. `UNKNOWN` deliberately does not exit `0`, so a truncated analysis cannot pass a pipeline. Add `--json` for machine-readable output, and `--max-states` / `--max-depth` / `--timeout-ms` to widen the budget.

### Or call it as a service

```bash
npm run serve:api      # http://127.0.0.1:8787, outward writes refused
```

```bash
curl -s localhost:8787/v1/fixtures

CID=$(curl -s -X POST localhost:8787/v1/compilations -H 'content-type: application/json' \
  -d "{\"schemaVersion\":\"1\",\"manifest\":$(cat examples/agent-manifest.json),\"policy\":$(cat examples/spend-policy.json)}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["compilationId"])')

curl -s -X POST localhost:8787/v1/runs -H 'content-type: application/json' \
  -d "{\"compilationId\":\"$CID\",\"adversarialRecipients\":[\"unknown-vendor\"]}"
```

The eight endpoints in [`docs/openapi.yaml`](docs/openapi.yaml) are implemented in `packages/api`, on `node:http` with no additional dependencies, so exposing an API does not cost the workspace its zero-advisory dependency graph.

Behaviours worth calling out, all covered by tests:

- **Outward writes are refused by default.** Publishing evidence to 0G Storage or anchoring on 0G Chain returns `403 EXTERNAL_WRITE_NOT_APPROVED` unless the server is started with an approval. An HTTP route is not an exemption from the approval boundary the rest of the system enforces.
- **A fixture cannot be run against an unrelated model.** Fixtures name both a model and the recipients that count as loss, so pairing one fixture's recipients with someone else's compilation returns zero, which reads as a pass while answering a different question. That mismatch is a `409`, not a quiet zero.
- **The per-request search budget is capped, and exceeding it is refused rather than clamped.** Stress testing measured a single unbounded request at roughly 36 seconds of CPU and 680 MB of RSS, which a rate limit does not contain because the cost sits inside one request. The server holds its own ceiling below the schema maxima and returns `LIMIT_OUT_OF_RANGE`, because a silently reduced budget would change what the returned bound covers without telling the caller.
- **Bearer authentication**, compared by digest under `timingSafeEqual`. An empty key list means the deployment is deliberately open; blank entries cannot silently open one that meant to be closed.
- **Rate limiting**, checked before authentication so an unauthenticated flood cannot spend the server's time on key comparison. `x-forwarded-for` is trusted only when the deployment declares it sits behind a proxy, because trusting it otherwise lets a caller mint a new identity per request and turn the limiter off.
- **Durable records** written with write-then-rename, so a crash mid-write leaves the previous record intact rather than a truncated one, and record ids that could escape the store directory are rejected.

[`docs/CODE-REVIEW.md`](docs/CODE-REVIEW.md) records the adversarial pass these came out of, including what was measured and what remains open.

---

## How 0G is used

**0G Chain, load-bearing.** The `RunRegistry` contract binds each result to the exact inputs that produced it: the policy hash, the graph hash, the engine version hash, the bundle root, and the claimed maximum loss. Two properties are enforced in Solidity rather than in the client:

- Anchors are namespaced per submitter, so nobody can front-run a bundle root and squat on someone else's result.
- An `UNKNOWN` result is rejected if it carries a loss claim. You cannot anchor "we could not finish the analysis" and also assert a number.

Remove the chain anchor and the product promise disappears: a maximum-loss number nobody can verify against a fixed model version is just a claim in a log file.

`contracts/src/RunRegistry.sol` is 68 lines of Solidity with no external dependencies, covered by 5 Foundry tests.

**0G Storage, load-bearing.** Every evidence bundle is uploaded to 0G Storage, then downloaded back and re-verified before the upload is recorded at all. Verification is deliberately stricter than trusting the SDK's proof flag: the adapter re-derives the Merkle root from the bytes that came back and compares it to the root it asked for, so corrupted content cannot pass as verified.

Remove Storage and a third party cannot reconstruct the run from a content-addressed object, which is the other half of the evidence promise.

The upload path is a mutation, so it refuses to run without a scoped, unexpired approval bound to the exact bytes. Wrong scope, wrong network, expired approval or a missing signer all fail before the vendor SDK is reached, and `tests/phase2/storage-0g.test.ts` asserts no outward call happens in each of those cases.

**0G Compute: typed port, not live.** `packages/zerog` defines `ComputePort` alongside the live Storage and Chain adapters. It is not wired to the vendor SDK. Reasoning is below rather than papered over.

---

## Reproduce it

Requires Node.js 22+ and [Foundry](https://getfoundry.sh).

```bash
npm install
npm test                 # 127 TypeScript tests across 16 files
forge test --offline     # 5 Solidity tests, no external libs
npm run typecheck        # strict, no errors
```

Regenerate a run and inspect the exact values that get anchored:

```bash
npx vite-node scripts/anchor-run.ts prompt-injection
cat contracts/deployments/anchor-request.json
```

Verify an anchor straight from 0G Chain, without trusting this repository:

```bash
cast call 0xDeA0792cEc959CE6893C24dEeFc6FE9B047a3Ea3 \
  "getAnchor(address,bytes32)((bytes32,bytes32,uint256,bytes32,uint8,address,uint64))" \
  0xf9946775891a24462cD4ec885d0D4E2675C84355 \
  0x304ff5d34bef92e9ddd4e5cbfe8bb83c8629f5aa1da20c4ea1b8ad3816cd27b0 \
  --rpc-url https://evmrpc-testnet.0g.ai
```

The third field returned is `27500000`, matching the `prompt-injection` row above.

Deploy and anchor yourself. The preferred signer is an encrypted Foundry keystore, so the key never reaches argv, shell history, or a plaintext file:

```bash
cast wallet import worstcase --interactive   # once
export ETH_KEYSTORE_ACCOUNT=worstcase

./contracts/deploy-0g.sh galileo      # deploy the registry
./scripts/anchor-all.sh galileo       # anchor every fixture run on 0G Chain
./contracts/storage-0g.sh galileo     # upload every evidence bundle to 0G Storage
```

A plaintext `contracts/.env` holding `PRIVATE_KEY=0x…` also works as a fallback, and the scripts say so out loud when you use it, because that path hands the key to `forge` as a command-line argument where `ps` can see it. Fine for a throwaway testnet key, not for one holding real value.

Before broadcasting, both scripts confirm the RPC actually reports the chain ID you named, and every line of tool output passes through a redactor.

---

## Architecture

```
 MCP manifest ──┐
                ├──▶ compiler ──▶ economic graph ──▶ checker ──▶ result + counterexample
 spend policy ──┘      │              │                              │
                       │              │                              ▼
                  rejects        graphHash                    evidence bundle
                unsupported      policyHash                 (canonical JSON, SHA-256)
                   actions                                          │
                                                                    ▼
                                                          0G Chain RunRegistry
                                                        (bundleRoot → bound result)
```

| Package | Role |
|---|---|
| `packages/contracts` | Schemas, canonical JSON, hashing. The single source of truth for what a run is |
| `packages/compiler` | Manifest + policy to finite economic graph, with explicit support boundaries |
| `packages/checker` | Deterministic maximum-loss search and shortest counterexample |
| `packages/evidence` | Canonical bundle creation and byte-exact replay verification |
| `packages/zerog` | 0G ports, approval boundary, isolated adapter runtime, mutation journal |
| `contracts/` | `RunRegistry` Solidity, Foundry tests, deploy and anchor scripts |
| `packages/api` | The v1 HTTP surface from `docs/openapi.yaml`, on `node:http` |
| `apps/web` | Trace Ledger interface over checked artifacts |

Deeper documents: [`docs/model-semantics.md`](docs/model-semantics.md), [`docs/threat-model.md`](docs/threat-model.md), [`docs/adapter-isolation.md`](docs/adapter-isolation.md), [`docs/openapi.yaml`](docs/openapi.yaml).

---

## What is not done

Stated plainly, because a security tool that overstates itself is the thing it claims to prevent.

- **0G Compute is not live.** The Compute SDK's own source shows that generating request headers can trigger an on-chain balance check and provider funding path, so it cannot be treated as read-only or run ahead of a funding approval boundary. It stays a typed port until that runs behind the isolated adapter (container policy, egress allowlist, mutation journal, process supervisor) that is already built and tested. Findings are in [`reports/0g-sdk-dependency-risk.md`](reports/0g-sdk-dependency-risk.md).
- **The Storage SDK was admitted under pinned overrides, not as-is.** Installed alone it pulls 5 advisories, 4 of them high, from `axios`, `ws` and `ethers`. The workspace pins all three past their advisories through `overrides`, which brings `npm audit` to zero across the workspace's 180 packages, and a live upload-download round trip proves the SDK still works with the patched versions rather than assuming it. If that audit stops reading zero, this integration is a regression and should be treated as one.
- **Testnet, not mainnet.** Everything above is 0G Galileo, chain 16602. Mainnet deployment is the next step.
- **The bound is conservative within a declared model.** It is not formal verification of an arbitrary agent, and it does not prove an agent is safe. It answers a narrower question honestly.
- **Fixtures are synthetic.** All adversarial balances and effects are planted. No real funds move anywhere in this repository.
- **The checker used to replay declared paths rather than search.** Until 2026-08-31 it iterated a hand-written `candidateTrajectories` list and reported the best of those, while calling the answer a maximum. On the headline fixture that understated the reachable loss by 2.6x, and deleting a trajectory silently lowered the reported bound. It now enumerates the reachable state space; `tests/phase1/unknown.test.ts` asserts the bound does not move when declared paths are removed, and every anchor above was re-published against the corrected engine. Recorded here because a tool that exists to catch overstated safety claims does not get to quietly fix its own.

## License

MIT
