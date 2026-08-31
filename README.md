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

Five planted attacks, one clean baseline, and the same drain re-checked after a one-line policy fix. Amounts are in base units of a 6-decimal stablecoin, so `27500000` is $27.50.

| Fixture | What it plants | Max loss found | On-chain anchor |
|---|---|---|---|
| `prompt-injection` | Hostile tool output proposes an extra transfer | 27,500,000 | [tx](https://chainscan-galileo.0g.ai/tx/0x4c216c3b8cb6a64548cfe61572f8df8d19436c3489ed4ce624c3edfe035538c2) |
| `recipient-swap` | Mutable recipient field redirects a valid amount | 25,000,000 | [tx](https://chainscan-galileo.0g.ai/tx/0x738fbe6448cc292a891e6d9b5722bf544b1896642893cf8714a5791f03055b58) |
| `replay` | A signed intent is submitted more than once | 20,000,000 | [tx](https://chainscan-galileo.0g.ai/tx/0x5f82745444ca156e0b08abe75e74b7baf12775b7c7f0ea78d96712f5c0679df9) |
| `concurrency` | Parallel calls each pass a per-call cap | 60,000,000 | [tx](https://chainscan-galileo.0g.ai/tx/0x38edc5112e2fd569aacc011a0631664cae1fa3dd7b046c53018c65793e5e9d11) |
| `recursive-tool` | A paid tool calls itself through a budget gap | 40,000,000 | [tx](https://chainscan-galileo.0g.ai/tx/0x84e840ea348eaf953b9eb3b497c93f2dade1c3f820547f4d28c7b3425d56aad3) |
| `clean` | Nothing. This is the false-positive check | **0** | [tx](https://chainscan-galileo.0g.ai/tx/0xf0152ebcae6ca4e6e85b7bbefaf555c5f4ca36acce61b2d7ce211442684d5914) |
| `policy-fix` | The drain, after tightening one policy edge | **0** | [tx](https://chainscan-galileo.0g.ai/tx/0xb8cfb0cdb5cf5043f879a01e3681506f3e1b07a2b84cd04c36a3881caabd3d1b) |

The last two rows are the point. A checker that flags everything is useless, and a checker you cannot act on is also useless. `clean` returns zero, and `policy-fix` shows a real drain going to zero after a specific, named change.

### The same seven bundles on 0G Storage

Each evidence bundle was uploaded, then downloaded back and re-derived to the same Merkle root before the upload was recorded. Records live in `contracts/deployments/16602-storage-*.json`.

| Fixture | Storage root | Upload |
|---|---|---|
| `prompt-injection` | `0x3b613305…c852d64ef` | [tx](https://chainscan-galileo.0g.ai/tx/0xe1e5bf060d67b40fdcc5f116c3ad02b6fb22ff5a4ee88e34060b11451c26d4cd) |
| `recipient-swap` | `0x226b8f76…597c4858` | [tx](https://chainscan-galileo.0g.ai/tx/0xa7d5c43b879cff577da642f847bfae36c5f07276d9c34c3beaaf861668bf0226) |
| `replay` | `0x55e0f3f4…50560133` | [tx](https://chainscan-galileo.0g.ai/tx/0xfb35f1d9212c5c624175ec43ec95a407f3dc3ca1c74c26883ea2fc7b2bd4fc73) |
| `concurrency` | `0x59fa6754…3c35cb30` | [tx](https://chainscan-galileo.0g.ai/tx/0xe622578e51eb9f09daba897634dc6c78785a56bf1ae9aa3c4baf14d1fe19c5e8) |
| `recursive-tool` | `0x2d5a2037…593d2d00` | [tx](https://chainscan-galileo.0g.ai/tx/0x12a7c9bc636373775012905a175cb9557f5132f7d5d5557ed598a9e75378c288) |
| `clean` | `0x599159c6…a0042236` | already stored, no new transaction |
| `policy-fix` | `0xa92d6d92…873c98ed` | [tx](https://chainscan-galileo.0g.ai/tx/0xb73e61189ea8faaacb8176f790d1fe8740f7bf746939447a6a9d5bda4e78e90f) |

The `clean` row is worth reading rather than skipping. 0G Storage is content addressed, so re-uploading identical bytes creates no transaction. The interface reports that as "stored and re-verified" with no transaction link, instead of linking a transaction that does not exist. A test enforces that distinction.

---

## The problem

Give an agent a wallet and a set of tools and you have created a spending program whose control flow is decided at runtime by a model. The usual answers are per-call limits and human approval prompts. Neither tells you the number you actually want before you fund the thing:

> If everything goes wrong at once, how much can leave this wallet?

Per-call caps do not compose. Five calls that each pass a $20 cap can still drain $60 if they run concurrently, which is exactly what the `concurrency` fixture demonstrates. A single-step guard cannot see a multi-step path.

## What Worstcase does

1. **Compile.** An MCP manifest plus a spending policy become a finite state graph. Anything the compiler does not model is rejected loudly rather than silently ignored.
2. **Check.** Deterministic exploration over reachable states finds the maximum transferable value and the shortest path that reaches it.
3. **Explain.** Output is a concrete counterexample: an ordered list of tool calls, plus the policy checks that blocked the alternatives.
4. **Anchor.** The run is hashed into a canonical evidence bundle and recorded on 0G Chain, so the bound is bound to an exact model version and cannot be quietly restated later.

Truncated search, an unsupported action, or a timeout produce `UNKNOWN`. Never "safe". This is the property most tools in this space get wrong: absence of a finding is reported as a pass.

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
npm test                 # 94 TypeScript tests across 13 files
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
  0x5fe0f91bb5401fbf0a5708970eddb62415fe3748e194a23c333805342062d44a \
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

## License

MIT
