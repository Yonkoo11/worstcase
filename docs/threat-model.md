# Worstcase Threat Model

## Protected properties

- **INV-01 — No understated completion:** a `COMPLETE` result matches the declared graph and explored limits; incomplete work is `UNKNOWN`.
- **INV-02 — Deterministic authority:** only the local checker calculates status, amount, path, and blocking edge.
- **INV-03 — Synthetic isolation:** fixture execution cannot access real signing, payments, arbitrary network targets, or host secrets.
- **INV-04 — Context binding:** run, manifest, policy, graph, fixture, engine, provider, Storage network/root, chain ID, and registry are bound and checked.
- **INV-05 — Integer money:** all monetary values are bigint base units; no floating point or implicit conversion.
- **INV-06 — Immutable inputs:** editing creates a new run; terminal evidence never rewrites its source identity.
- **INV-07 — Idempotent mutations:** retries cannot create duplicate Compute jobs, Storage uploads, or Chain anchors.
- **INV-08 — Proof before verified:** provider, Storage, replay, and Chain checks must all pass before the corresponding verified flag.
- **INV-09 — No secret propagation:** operator keys, tokens, raw environment values, and uncontrolled payload content never enter browser state, logs, bundles, screenshots, or model-visible context.
- **INV-10 — Explicit support:** ambiguous or unknown tool semantics are `UNSUPPORTED`, never guessed.

## Threat actors and paths

- A malicious manifest embeds prompt instructions, enormous graphs, duplicate IDs, misleading names, or undeclared effects.
- A model/provider proposes graph-external actions, false amounts, malformed JSON, replayed responses, or mismatched provenance.
- A user retries/concurrently submits runs or mutations to double-spend provider balances or create conflicting evidence.
- A Storage/indexer/RPC response serves corrupt bytes, wrong-network data, stale events, or a valid proof for the wrong context.
- A browser or fixture attempts to reach operator credentials or trigger signing.
- A developer accidentally treats `UNKNOWN`, `UNSUPPORTED`, replay, fixture, or testnet evidence as live safety proof.

## Required controls

Strict schemas and byte limits; canonical hashes and versions; server-side adapters; sandbox deny-by-default; durable idempotency; bounded exploration; context/domain separation; proof verification; typed state labels; redacted structured logging; approval capabilities for external writes; oracle/property/contract/live test separation.

## Residual limits

The checker cannot cover undeclared behavior, arbitrary Turing-complete tools, vulnerabilities inside 0G or wallet software, economic price conversion, or real-world recipient control beyond declared identities. Results must state these limits beside the bound.
