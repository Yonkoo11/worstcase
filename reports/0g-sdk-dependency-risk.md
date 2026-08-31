# Draft upstream report: unresolved security advisories in current 0G TypeScript SDK graph

Status: **draft only — not submitted upstream**  
Observed: 2026-08-17  
Consumer: Worstcase, Node.js 22

## Summary

Installing the current official TypeScript SDK pair with its compatible Ethers peer expanded a clean 58-package project graph to 384 packages and caused `npm audit` to report 23 known vulnerabilities: 15 low, 2 moderate, and 6 high. The affected graph was removed immediately; the project returned to `npm audit --audit-level=high` reporting zero known vulnerabilities.

## Reproduction used

```text
npm install --save-exact @0gfoundation/0g-compute-ts-sdk@0.9.0 @0gfoundation/0g-storage-ts-sdk@1.2.11 ethers@6.13.1
npm audit
```

Ethers 6.13.1 was used because Storage SDK 1.2.11 declares that exact peer. An earlier attempt with Ethers 6.17.0 correctly failed dependency resolution and was not forced.

## High-severity paths observed

- `adm-zip <0.6.0`: crafted ZIP input may trigger a roughly 4 GB allocation; the path was introduced by the Compute SDK and npm reported no fix in the resolved graph.
- `elliptic`: unresolved high-severity advisories arrived through Compute SDK cryptographic/browser compatibility dependencies and an Ethers v5-era internal path.
- `ws`: unresolved memory-disclosure/denial-of-service advisory in the resolved range.
- `axios`: an older version arrived through `open-jsonrpc-provider`; npm indicated that a corrected dependency range may exist.

The install also emitted deprecation warnings for `crypto-js` and `yaeti`. Those warnings are maintenance signals, not vulnerabilities by themselves.

## Impact on consumers

Worstcase cannot place this graph in the main API/checker process or allow it to handle operator signing material under its current release policy. The broad transitive graph increases the blast radius of provider input parsing and network responses. The `adm-zip` issue is particularly relevant if any provider-controlled archive can reach that package.

## Requested upstream action

1. Upgrade or replace the affected direct/transitive packages and publish patched SDK releases.
2. Remove legacy Ethers v5/browser crypto paths where they are not required.
3. Document which SDK entry points can reach archive, WebSocket, and legacy crypto dependencies.
4. Add an advisory gate for high/critical production dependencies in SDK release CI.
5. Relax the Storage SDK's exact Ethers peer pin if compatibility permits.

## Current consumer workaround

- The SDKs are not installed in the Worstcase application graph.
- Integration code targets narrow `ComputePort`, `StoragePort`, and `ChainPort` interfaces.
- A future SDK-backed adapter must run in a separate least-privilege process with no checker authority, bounded input/output, network allowlisting, and isolated signer capability.
- No live 0G Compute, Storage, or Chain claim will be made until a safe adapter is implemented and exercised.

## Disclosure note

This draft contains dependency/audit observations only. It has not been sent to 0G, opened as an issue, or published. Exact advisory identifiers and a fresh clean-room reproduction should be attached immediately before any approved upstream submission.

---

## Resolution, 2026-08-31

The quarantine on **0G Storage is lifted**. The quarantine on **0G Compute remains**.

### What changed

The original finding measured the *combined* Compute + Storage install: 384 packages, 23 advisories, 6 high. Measuring the Storage SDK on its own gives a much smaller surface: 59 packages, 5 advisories, 4 high. The advisories are not in 0G's own code. They come from three transitive dependencies:

| Package | Installed | Advisory | Vulnerable range |
|---|---|---|---|
| `axios` | 0.27.2 | Cross-Site Request Forgery | `<=0.32.0` |
| `ws` | 8.17.1 | Uninitialized memory disclosure | `8.0.0 - 8.20.1` |
| `ethers` | 6.13.1 | moderate, transitive | `6.0.0-beta.1 - 6.16.0` |

All three have patched releases. Pinning them through workspace `overrides` (`axios ^1.12.0`, `ws ^8.21.0`, `ethers ^6.17.0`) brings the whole workspace to **zero advisories at every severity across 131 packages**.

### Why the audit number alone was not accepted as evidence

`axios` 0.27 to 1.x is a major version change, and the SDK pins `ethers` to exactly 6.13.1, so forcing 6.17.0 overrides the vendor's own constraint. Either could break the SDK at runtime while `npm audit` still reads clean. A green audit over a broken integration would be a worse outcome than the quarantine.

So the overrides were validated by function, not by audit output: a real evidence bundle was uploaded to 0G Storage on Galileo, downloaded back with proof, and compared byte for byte. It matched. All seven bundles were then uploaded the same way, each verified by re-deriving the Merkle root from the returned bytes before the upload was recorded.

### Standing condition

This admission is conditional on the overrides holding. If `npm audit` stops reporting zero, or if a future SDK release moves off the pinned versions, the Storage integration is a regression and should be treated as one rather than grandfathered.

### 0G Compute is still out

Nothing about the dependency finding was the blocking reason for Compute. The blocking reason is behavioural and unchanged: generating inference request headers can trigger an on-chain balance check and provider funding path, so it cannot be treated as read-only or executed ahead of a funding approval boundary. It stays a typed port until it runs behind the isolated adapter with a provider-enforced spend ceiling.
