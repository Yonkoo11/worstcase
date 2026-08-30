# 0G Storage Go client admission review

Reviewed: 2026-08-18  
Source: official `0gfoundation/0g-storage-client` main branch at `47a2992ec1d45f2032fa9b27efbc3cd23f16523d` (2026-06-13)  
Decision: CLI rejected; Go library remains a conditional Storage-only candidate.

## Findings

The CLI is not admissible. Its upload command accepts the private key through `--key`, exposes a floating-point `--fee`, accepts arbitrary RPC/indexer/node URLs and file paths, and enables transaction retries. Passing a signer secret in process arguments violates Worstcase's credential boundary; floating-point fee input violates the integer-money rule.

The library has useful controls that the CLI surface hides:

- `EstimateFee` derives the protocol fee as a `big.Int` from the data and the on-chain price per sector.
- `TransactionOption` accepts an exact `Fee`, `MaxGasPrice`, nonce, retry count, and an `OnSubmitted` callback.
- `common/blockchain.CustomGasLimit` and `CustomGasPrice` can bound transaction gas inside a dedicated one-operation process.
- `OnSubmitted` fires when a transaction hash first exists, before receipt waiting and segment upload.
- Download supports Merkle-proof verification.

These primitives could support a hard pre-dispatch bound of `protocolFee + gasLimit * maxGasPrice`, provided a wrapper independently recomputes the data root and fee immediately before signing.

## Remaining blockers

1. Gas-bump retries may broadcast multiple replacement hashes. The source explicitly says `OnSubmitted` can fire more than once. Every hash must be durably recorded and reconciled; storing only the final response is insufficient.
2. Worstcase's current child protocol returns one final JSON response. It has no acknowledged event frame for “transaction broadcast,” so the parent cannot prove that a hash was durably journaled before the child continues.
3. The repository has a large Go dependency graph, including go-ethereum and networking/server packages. `go` and `govulncheck` are not installed in the current environment, so no local build, test, or vulnerability result was produced.
4. The deployment still needs a fixed RPC/indexer/node allowlist, private scratch path, signer injection without argv, and OS/container egress and resource controls.
5. Main-branch behavior is not a released, pinned dependency decision. A reviewed tag or commit plus checksum must be locked before implementation.

## Admission requirements

- Build a minimal Go Storage wrapper against a pinned reviewed commit; do not invoke the general CLI.
- Read the signer from a dedicated inherited file descriptor or deployment secret mount, never argv or logs.
- Quote exact protocol fee plus worst-case gas before reservation, and set both gas limit and maximum gas price from the approval.
- Add a framed `SUBMITTED` event carrying each transaction hash. The durable journal must fsync the event and acknowledge it before the child continues receipt waiting.
- Reconcile every replacement hash by nonce before allowing retry.
- Run Go unit tests, `go test -race`, `govulncheck`, dependency/license review, process-kill tests at pre-broadcast/post-broadcast points, and one separately approved Galileo rehearsal.

No SDK was added to the Worstcase dependency graph, and no signer, network request, upload, or transaction was used during this review.
