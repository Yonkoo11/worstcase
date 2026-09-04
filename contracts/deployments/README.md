# Deployment records

Two networks are in play, and the files are named by chain ID so they cannot be confused.

| Chain | ID | What runs there | Files |
|---|---|---|---|
| 0G mainnet | 16661 | **The current anchors.** RunRegistry, one deploy plus seven anchors. | `16661.json`, `16661-anchor-*.json` |
| 0G Galileo | 16602 | 0G Storage uploads, because the Turbo indexer is a Galileo service. Also the earlier RunRegistry deployment, kept as history. | `16602-storage-*.json`, `16602.json`, `16602-anchor-*.json` |

## Which contract is live

`16661.json` names the current registry:

```
0xf35bE6FFEBF91AcC27A78696cf912595C6b08AAA   0G mainnet, chain 16661
```

The `16602-anchor-*.json` files point at a different address. That deployment is
**superseded**, not current. Those files are kept because the transactions really happened
and deleting them would quietly rewrite what the project claimed on a given day. Nothing in
the codebase reads them.

## Reading an anchor back

Every `16661-anchor-*.json` can be checked against the chain without trusting this repository:

```bash
cast call 0xf35bE6FFEBF91AcC27A78696cf912595C6b08AAA \
  "getAnchor(address,bytes32)((bytes32,bytes32,uint256,bytes32,uint8,address,uint64))" \
  <submitter> <bundleRoot> \
  --rpc-url https://evmrpc.0g.ai
```

The third value returned is `maximumLoss` in base units, and it must equal
`maximumLossBaseUnits` in the JSON file. The policy hash and graph hash it returns must equal
the ones inside the matching `evidence/<bundleRoot>.json`. If either differs, trust the chain.

## Storage records

`16602-storage-*.json` carry a `verified` block:

```json
"verified": { "proofValid": true, "bytesMatch": true }
```

Both must be true. `proofValid` alone only says the indexer returned a well formed proof;
`bytesMatch` says the bundle was downloaded again and came back byte for byte identical.
One record, `16602-storage-replay.json`, has an empty `storageTx` and `alreadyStored: true`.
That is not a failure. 0G Storage is content addressed, so re-uploading identical bytes
creates no transaction. It is recorded as deduplication, and the interface shows no
transaction link for it, rather than linking a transaction that does not exist. Its proof
and byte comparison still had to pass.
