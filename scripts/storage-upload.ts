/**
 * Upload a Worstcase evidence bundle to 0G Storage, then download it back and
 * verify the returned bytes are byte-identical to what we uploaded.
 *
 * Run through contracts/storage-0g.sh so the signing key is sourced into the
 * process environment by bash rather than read from a file here.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ZeroGStorage } from "../packages/zerog/src/storage-0g.js";
import type { ExternalWriteApproval, MutationContext } from "../packages/zerog/src/index.js";

const NETWORKS = {
  galileo: { indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai", chainRpcUrl: "https://evmrpc-testnet.0g.ai", chainId: 16602 },
} as const;

const networkName = (process.argv[2] ?? "galileo") as keyof typeof NETWORKS;
const bundlePath = process.argv[3];
const config = NETWORKS[networkName];
if (config === undefined || bundlePath === undefined) {
  console.error("usage: storage-upload.ts <galileo> <path-to-evidence-bundle.json>");
  process.exit(1);
}

const bytes = new Uint8Array(readFileSync(bundlePath));
const canonicalRequestHash = `0x${createHash("sha256").update(bytes).digest("hex")}` as `0x${string}`;

const storage = new ZeroGStorage({ indexerUrl: config.indexerUrl, chainRpcUrl: config.chainRpcUrl, network: networkName });

// This upload is an approved, operator-initiated action on a testnet with a
// throwaway key. The approval is scoped to these exact bytes and expires.
const approval: ExternalWriteApproval = {
  approvalId: `storage-${canonicalRequestHash.slice(2, 18)}`,
  action: "STORAGE_UPLOAD",
  scope: `bundle:${canonicalRequestHash}`,
  network: networkName,
  canonicalRequestHash,
  maximumSpendBaseUnits: "0",
  expiresAtUnixMs: Date.now() + 10 * 60 * 1000,
};
const context: MutationContext = { idempotencyKey: `upload-${canonicalRequestHash.slice(2, 34)}`, canonicalRequestHash, approval };

const localRoot = await storage.computeRoot(bytes);
console.log(`bundle:      ${bundlePath} (${bytes.length} bytes)`);
console.log(`merkle root: ${localRoot}`);

const { root, transactionId } = await storage.upload(bytes, context, new AbortController().signal);
console.log(`uploaded:    root ${root}`);
console.log(`tx:          ${transactionId}`);

const { bytes: back, proofValid } = await storage.download(root, new AbortController().signal);
const identical = back.length === bytes.length && Buffer.compare(Buffer.from(back), Buffer.from(bytes)) === 0;
console.log(`proofValid:  ${proofValid}`);
console.log(`bytesMatch:  ${identical}`);
if (!proofValid || !identical) {
  console.error("Round trip failed verification; not recording this upload.");
  process.exit(2);
}

const fixtureId = (JSON.parse(new TextDecoder().decode(bytes)) as { run: { fixtureIds: string[] } }).run.fixtureIds[0];
mkdirSync("contracts/deployments", { recursive: true });
// Content-addressed storage returns no transaction when identical bytes are
// already stored. Record that as deduplication rather than inventing a link.
const alreadyStored = transactionId === "";
writeFileSync(
  `contracts/deployments/${config.chainId}-storage-${fixtureId}.json`,
  `${JSON.stringify(
    {
      network: networkName,
      chainId: config.chainId,
      fixtureId,
      storageRoot: root,
      storageTx: alreadyStored ? null : transactionId,
      alreadyStored,
      indexerUrl: config.indexerUrl,
      explorerTx: alreadyStored ? null : `https://chainscan-galileo.0g.ai/tx/${transactionId}`,
      verified: { proofValid, bytesMatch: identical },
    },
    null,
    2,
  )}\n`,
  "utf8",
);
if (alreadyStored) console.log("note:        identical bytes were already stored, so no new transaction was created");
console.log(`record:      contracts/deployments/${config.chainId}-storage-${fixtureId}.json`);
