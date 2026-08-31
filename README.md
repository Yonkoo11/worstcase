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
| `prompt-injection` | Hostile tool output proposes an extra transfer | 27,500,000 | [tx](https://chainscan-galileo.0g.ai/tx/0x452eeef9df2bb19ef6bf7197fc844c79f7088b7c4a4f3c0ef81265debb64c04a) |
| `recipient-swap` | Mutable recipient field redirects a valid amount | 25,000,000 | [tx](https://chainscan-galileo.0g.ai/tx/0x3f71b07726d3b73990798dc2d3433fc2b59bf262a14304a4a79c313f184e99d1) |
| `replay` | A signed intent is submitted more than once | 20,000,000 | [tx](https://chainscan-galileo.0g.ai/tx/0x7af36d1ff96f458ca1c47baa17232866adf9229c78b844f020c90cc6fe8cbc7c) |
| `concurrency` | Parallel calls each pass a per-call cap | 60,000,000 | [tx](https://chainscan-galileo.0g.ai/tx/0x1b8cf2b9246ec42db33d9894f5a1976a4cc50748f6f9442ede14f5cb0bbd0ae8) |
| `recursive-tool` | A paid tool calls itself through a budget gap | 40,000,000 | [tx](https://chainscan-galileo.0g.ai/tx/0xc9b2d7276ef089e0963a44c039aa45f878ce7bb95b5bbce693d0b2ae5dfe5315) |
| `clean` | Nothing. This is the false-positive check | **0** | [tx](https://chainscan-galileo.0g.ai/tx/0x8e42dc1cd7f255fca273426485cf8f5425352a42505cd4f85715d6940b5cba05) |
| `policy-fix` | The drain, after tightening one policy edge | **0** | [tx](https://chainscan-galileo.0g.ai/tx/0xaa8bffcddaa32997ae613eb773e6789745998182e899443c64db0abe9b404098) |

The last two rows are the point. A checker that flags everything is useless, and a checker you cannot act on is also useless. `clean` returns zero, and `policy-fix` shows a real drain going to zero after a specific, named change.

### The same seven bundles on 0G Storage

Each evidence bundle was uploaded, then downloaded back and re-derived to the same Merkle root before the upload was recorded. Records live in `contracts/deployments/16602-storage-*.json`.

| Fixture | Storage root | Upload |
|---|---|---|
| `prompt-injection` | `0x90fc5c21…40eab199` | [tx](https://chainscan-galileo.0g.ai/tx/0x7ebe7fac0f4c8937fc2d53df95e71b7140cb05965672e4af4bb6917a7283ed38) |
| `recipient-swap` | `0xbd2352f1…bb099e72` | [tx](https://chainscan-galileo.0g.ai/tx/0x966d7d3b0504c69ceb9ae616f2b157a39c0ec4711bf39fe15e2ab7f8f674908c) |
| `replay` | `0x45020784…91cd3000` | [tx](https://chainscan-galileo.0g.ai/tx/0x71c8e7be7a277b58e1d2830a3edde4b2575eacb64463bd006237886dd0d4b445) |
| `concurrency` | `0xcb3702a5…43172c43` | [tx](https://chainscan-galileo.0g.ai/tx/0x6561771ec83d955610e2412c390e513846361841978dc7cb63120c126db60ba2) |
| `recursive-tool` | `0x4834d1a8…0054b156` | [tx](https://chainscan-galileo.0g.ai/tx/0xf508dea89ebe0b17e0b7474947219e34410a38bbf30fd3b8d852cc7d0aa39756) |
| `clean` | `0xde12b6ef…800f3213` | [tx](https://chainscan-galileo.0g.ai/tx/0xa22f83157c9adc35e00ef119167b792810255b36c977e575aad54882096de68a) |
| `policy-fix` | `0x78c1a371…8560676d` | [tx](https://chainscan-galileo.0g.ai/tx/0xb765fd28681459af410a19d1db2d8308a7cd5fa38b3826c9a51f6019be1acd98) |

The `clean` row is worth reading rather than skipping. 0G Storage is content addressed, so re-uploading identical bytes creates no transaction. The interface reports that as "stored and re-verified" with no transaction link, instead of linking a transaction that does not exist. A test enforces that distinction.

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
npm test                 # 99 TypeScript tests across 14 files
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
  0xafe7d23b996b20e1c169ccf034b12c88e01d03baaa02f40ab072323da61a0d28 \
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
| `apps/web` | Trace Ledger interface over checked artifacts |

Deeper documents: [`docs/model-semantics.md`](docs/model-semantics.md), [`docs/threat-model.md`](docs/threat-model.md), [`docs/adapter-isolation.md`](docs/adapter-isolation.md), [`docs/openapi.yaml`](docs/openapi.yaml).

---

## What is not done

Stated plainly, because a security tool that overstates itself is the thing it claims to prevent.

- **0G Compute is not live.** The Compute SDK's own source shows that generating request headers can trigger an on-chain balance check and provider funding path, so it cannot be treated as read-only or run ahead of a funding approval boundary. It stays a typed port until that runs behind the isolated adapter (container policy, egress allowlist, mutation journal, process supervisor) that is already built and tested. Findings are in [`reports/0g-sdk-dependency-risk.md`](reports/0g-sdk-dependency-risk.md).
- **The Storage SDK was admitted under pinned overrides, not as-is.** Installed alone it pulls 5 advisories, 4 of them high, from `axios`, `ws` and `ethers`. The workspace pins all three past their advisories through `overrides`, which brings `npm audit` to zero across 131 packages, and a live upload-download round trip proves the SDK still works with the patched versions rather than assuming it. If that audit stops reading zero, this integration is a regression and should be treated as one.
- **Testnet, not mainnet.** Everything above is 0G Galileo, chain 16602. Mainnet deployment is the next step.
- **The bound is conservative within a declared model.** It is not formal verification of an arbitrary agent, and it does not prove an agent is safe. It answers a narrower question honestly.
- **Fixtures are synthetic.** All adversarial balances and effects are planted. No real funds move anywhere in this repository.
- **The checker used to replay declared paths rather than search.** Until 2026-08-31 it iterated a hand-written `candidateTrajectories` list and reported the best of those, while calling the answer a maximum. On the headline fixture that understated the reachable loss by 2.6x, and deleting a trajectory silently lowered the reported bound. It now enumerates the reachable state space; `tests/phase1/unknown.test.ts` asserts the bound does not move when declared paths are removed, and every anchor above was re-published against the corrected engine. Recorded here because a tool that exists to catch overstated safety claims does not get to quietly fix its own.

## License

MIT
