# Worstcase v1 Model Semantics

## Claim boundary

The engine computes a conservative maximum external loss only over a supported, finite graph. It does not infer missing tool effects. Unsupported semantics return `UNSUPPORTED`; incomplete exploration returns `UNKNOWN`.

## Money and assets

- Every amount is a canonical non-negative decimal string in asset base units.
- Calculations use bigint. Floating point is forbidden.
- Every fixture declares adversarial recipient identities independently from the policy. Protected loss is value that leaves declared protected balances for those adversarial sinks, including approvals they consume, capped by the starting protected value. Legitimate policy-compliant spend to a non-adversarial recipient is not loss.
- Asset identity includes the declared asset ID and decimals; cross-asset conversion is unsupported in v1.

## State identity

State identity contains balances, cumulative spend, approvals, sorted consumed nonces, active calls, recursion depth, and terminal status. Object keys and set-like arrays are canonicalized before hashing. Run, manifest, policy, graph, fixture/adversarial-sink catalog, schema, and engine versions are domain-bound outside the state hash.

## Transition semantics

Transitions are atomic. Preconditions and policy checks run against the source state. Effects either apply completely to produce the destination state or the transition is blocked with one stable policy-check ID. Candidate transitions not present in the compiled graph are rejected.

Supported actions are `transfer`, `approve`, `callPaidTool`, `consumeBudget`, `advanceNonce`, `spawn`, and `recurse`. Adapters normalize declared fields only and never invent amounts, recipients, assets, or effects.

## Exploration and result ordering

- Bounded breadth-first exploration enumerates deterministic lexical transition order.
- Result ordering is maximum loss, then fewest transitions, then lexical transition-ID sequence.
- The complete state tuple participates in deduplication. Dominance pruning is forbidden until separately justified and property-tested.
- Exhausting depth, state, branch, concurrency, or time limits returns `UNKNOWN` with reached counters; it cannot return zero.

## Versions

- Schema version: `1`.
- Fixture catalog version: `1`.
- Phase 0 contract engine: `0.1.0-contract`.
- Any semantic change affecting hashes, reachability, loss, or ordering requires a new engine version and new oracle expectations.
