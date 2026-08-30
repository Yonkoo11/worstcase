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
