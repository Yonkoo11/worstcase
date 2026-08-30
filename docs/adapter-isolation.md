# 0G adapter isolation contract

Status: local envelope, execution runtime, and file-backed journal implemented and tested with fake handlers; no vendor-backed process or live call yet.

## Why this boundary exists

The deterministic checker must not inherit the network, archive parsing, wallet, or dependency surface of 0G SDKs. Compute execution can consume a provider sub-account and the current official SDK may check and fund that account while constructing request headers. Compute probing is therefore a spend-capable mutation, not a harmless read.

## Process split

```text
API/orchestrator
  -> canonical, size-bounded adapter envelope
  -> per-surface adapter process
       Compute: provider endpoints + compute-scoped account only
       Storage: storage/indexer endpoints + upload-scoped signer only
       Chain: allowlisted RPC + registry-only signer only
  -> typed, hash-bound response
  -> local validator/checker (never inside adapter)
```

No adapter process may import or call the checker. No checker process may import an SDK, read environment credentials, or access a network.

## Envelope

`AdapterRequestSchema` and `AdapterResponseSchema` in `packages/zerog` define the protocol. Requests bind protocol version, request ID, operation, network, canonical request hash, canonical base64 payload capped at 2 MiB decoded, and—only for mutations—a scoped approval and idempotency key. The runtime hashes the decoded payload and rejects a mismatch before invoking an operation handler. Unknown fields fail validation.

Mutation approval binds all of:

- exact action (`COMPUTE_PROBE`, `STORAGE_UPLOAD`, or `CHAIN_ANCHOR`);
- exact canonical request hash;
- exact network;
- resource scope;
- expiry;
- maximum external spend in base units.

The parent validates approval before starting the call. The child must independently validate it before using a signer or paid provider account.

## Runtime restrictions

- One surface per process/container; no shared signer.
- Read-only root filesystem and private bounded scratch directory.
- Egress allowlist from checked-in network/provider configuration; never accept a user URL.
- No shell interpolation, plugin loading, arbitrary calldata, arbitrary file path, or forwarded environment map.
- Hard input/output byte limits, wall timeout, memory/CPU quota, and one active mutation per idempotency key.
- Logs contain operation, request ID, network alias, hashes, timings, and stable error only—never payload, headers, keys, signatures, or response content.
- Durable idempotency record precedes any call that may spend or write. An ambiguous provider/transaction result blocks retry until reconciliation.
- `prepare` may inspect local request bytes and obtain a non-mutating quote only. It must not fund an account, create a paid request header, sign or broadcast a transaction, upload bytes, reserve paid capacity, or cause any other external write. The runtime checks the quote against the exact approval cap, reserves the idempotency key, and only then calls `execute`.
- A handler must enforce its quoted maximum at the provider or transaction boundary. The runtime's post-execution actual-spend check detects a broken quote and quarantines the idempotency key, but cannot undo an external overspend.

`InMemoryMutationJournal` proves retry and conflict semantics within one process only and is not eligible for a live adapter. `FileMutationJournal` creates one private, hash-named directory per idempotency key, persists state through fsynced temporary files and atomic rename, and fails closed when a reservation is incomplete or malformed. A missing submission-history field or duplicate persisted transaction hash invalidates the entry rather than being interpreted as an empty history. Reconstructed-instance tests prove completed and ambiguous state survive runtime reconstruction. Live admission still requires process crash-injection and concurrent-process tests on the actual deployment filesystem.

`runAdapterProcess` is the parent-side one-shot supervisor. It accepts only an absolute executable and working directory from trusted server configuration, never from a request; starts without a shell; forwards only an explicit environment map; sends one validated envelope; caps stdout and stderr; and enforces a wall timeout. Successful responses are decoded canonically and rehashed in the parent. Malformed output, request/result hash mismatch, abnormal exit, abort, or timeout is retryable for reads but `AMBIGUOUS_SUBMISSION` for a launched mutation. Local subprocess tests cover environment non-inheritance, bounded output, concurrent reservation, and force-kill recovery. OS/container egress, filesystem, identity, and resource controls remain deployment responsibilities and are not claimed by this function.

Mutation-capable vendor children use the framed supervisor. Each `SUBMITTED` frame binds request ID, transaction hash, and nonce. The parent durably records the frame before returning an `ACK`; the child must not continue until that acknowledgment arrives. Replacement hashes are reconciled per nonce. Automatic retry is allowed only when every recorded hash is explicitly dropped; partial settlement, pending/missing status, or contradictory confirmations remains blocked.

`deploy/adapter/compose.yaml` captures the default container policy: numeric non-root user, read-only root, all capabilities dropped, no-new-privileges, bounded PID/memory/CPU limits, and a small no-exec tmpfs. Its default has no network. A live vendor container requires a separately reviewed egress proxy with checked-in endpoint allowlists; a general bridge network is forbidden. `npm run verify:adapter:container` exercises the safe default against a cached test image.

`compose.storage-chain-egress.yaml` is the narrower networked profile. The adapter joins only an internal proxy network; only the proxy joins an outward network. Squid denies non-CONNECT methods, non-443 destinations, private/link-local/documentation ranges, credentials forwarded as proxy headers, and every domain except the checked-in Galileo RPC and Turbo Storage indexer. The application allowlist additionally binds each endpoint policy to the request network and operation. A deterministic test protects the deny-before-allow ACL order; the configuration still requires parsing by the exact pinned Squid image before admission. This profile is deliberately insufficient for `COMPUTE_PROBE`: live Compute provider endpoints are dynamic. Compute stays unavailable until signed provider discovery can produce a request-bound, public-IP-checked ephemeral rule without exposing a general proxy.

## Compute-specific rule

The current SDK's automatic balance behavior is not accepted as a hidden implementation detail. A vendor adapter must either:

1. prove that automatic top-up is disabled and return `FUNDING_REQUIRED` before creating headers; or
2. prove that the SDK's maximum possible top-up plus inference fee is bounded by the exact approved cap.

If neither can be proven, Compute remains unavailable. Existing pre-funded provider balance is still external spend and counts against the approval cap.

Provider output is only a candidate trajectory. The parent rejects request-hash mismatch, graph-external transition IDs, invalid provenance, malformed/oversized output, and any unverified response before the checker sees it.

## Storage-specific rule

The adapter computes the root before upload, records the first durable transaction/object identifier, downloads fresh bytes with proof, and returns both. The parent independently checks canonical bytes, root, context hashes, and deterministic replay. A proof for the wrong network or root is a hard failure.

## Chain-specific rule

The only allowed write is `RunRegistry.anchor` at the checked-in network/address. Calldata fields must byte-match the approved bundle projection. Reads include the expected submitter namespace. No deploy, upgrade, transfer, approval, or arbitrary contract method exists in the adapter operation set.

## Admission gate

A vendor-backed process is not admitted until dependency/security review, envelope contract tests, no-signer/no-network negative tests, spend-cap tests, crash-durable idempotency and ambiguous-submission reconciliation tests, and one separately labeled live testnet rehearsal pass. Local fakes never satisfy the live gate.
