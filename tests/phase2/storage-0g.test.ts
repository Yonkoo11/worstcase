import { describe, expect, it } from "vitest";
import { ZeroGStorage, type StorageIndexer } from "../../packages/zerog/src/storage-0g.js";
import type { ExternalWriteApproval, MutationContext } from "../../packages/zerog/src/index.js";

const NETWORK = "galileo";
const BYTES = new TextEncoder().encode('{"hello":"worstcase"}');
const KEY = "0x" + "11".repeat(32);

// Records whether the vendor SDK was reached at all. Any test that expects a
// refusal must also prove no outward call happened.
function spyIndexer(overrides: Partial<StorageIndexer> = {}): StorageIndexer & { uploads: number; downloads: number } {
  const spy = {
    uploads: 0,
    downloads: 0,
    async upload(): Promise<[unknown, Error | null]> {
      spy.uploads += 1;
      return [{ rootHash: "0x" + "ab".repeat(32), txHash: "0x" + "cd".repeat(32) }, null];
    },
    async downloadToBlob(): Promise<[{ arrayBuffer(): Promise<ArrayBuffer> }, Error | null]> {
      spy.downloads += 1;
      return [{ async arrayBuffer() { return BYTES.buffer.slice(0) as ArrayBuffer; } }, null];
    },
    ...overrides,
  } as StorageIndexer & { uploads: number; downloads: number };
  return spy;
}

function storage(indexer: StorageIndexer) {
  return new ZeroGStorage({
    indexerUrl: "https://indexer.invalid",
    chainRpcUrl: "https://rpc.invalid",
    network: NETWORK,
    privateKeyProvider: () => KEY,
    indexerFactory: () => indexer,
  });
}

async function contextFor(bytes: Uint8Array, patch: Partial<ExternalWriteApproval> = {}): Promise<MutationContext> {
  const { createHash } = await import("node:crypto");
  const hash = `0x${createHash("sha256").update(bytes).digest("hex")}` as `0x${string}`;
  return {
    idempotencyKey: `upload-${hash.slice(2, 34)}`,
    canonicalRequestHash: hash,
    approval: {
      approvalId: "a-1",
      action: "STORAGE_UPLOAD",
      scope: `bundle:${hash}`,
      network: NETWORK,
      canonicalRequestHash: hash,
      maximumSpendBaseUnits: "0",
      expiresAtUnixMs: Date.now() + 60_000,
      ...patch,
    },
  };
}

describe("live 0G Storage adapter", () => {
  it("computes a stable 32-byte merkle root without a signer or a network call", async () => {
    const indexer = spyIndexer();
    const root = await storage(indexer).computeRoot(BYTES);
    expect(root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await storage(indexer).computeRoot(BYTES)).toBe(root);
    expect(indexer.uploads).toBe(0);
  });

  it("uploads only with a scoped, unexpired approval and returns the locally derived root", async () => {
    const indexer = spyIndexer();
    const subject = storage(indexer);
    const context = await contextFor(BYTES);
    const expected = await subject.computeRoot(BYTES);

    // The spy returns a different rootHash, so a passing assertion here proves
    // the adapter trusts its own derivation rather than the network's claim.
    await expect(subject.upload(BYTES, context, new AbortController().signal)).rejects.toThrow("STORAGE_ROOT_MISMATCH");
    expect(expected).not.toBe("0x" + "ab".repeat(32));
    expect(indexer.uploads).toBe(1);
  });

  it("returns the upload when the network agrees with the locally derived root", async () => {
    const indexer = spyIndexer();
    const subject = storage(indexer);
    const root = await subject.computeRoot(BYTES);
    const agreeing = spyIndexer({
      async upload(): Promise<[unknown, Error | null]> {
        agreeing.uploads += 1;
        return [{ rootHash: root, txHash: "0x" + "cd".repeat(32) }, null];
      },
    });
    const result = await storage(agreeing).upload(BYTES, await contextFor(BYTES), new AbortController().signal);
    expect(result.root).toBe(root);
    expect(result.transactionId).toBe("0x" + "cd".repeat(32));
  });

  it.each([
    ["a mismatched scope", { scope: "bundle:0xdeadbeef" }],
    ["a different network", { network: "mainnet" }],
    ["an expired approval", { expiresAtUnixMs: Date.now() - 1 }],
    ["the wrong action", { action: "CHAIN_ANCHOR" as const }],
  ])("refuses to upload with %s, and never reaches the network", async (_label, patch) => {
    const indexer = spyIndexer();
    const context = await contextFor(BYTES, patch);
    await expect(storage(indexer).upload(BYTES, context, new AbortController().signal)).rejects.toThrow("EXTERNAL_WRITE_NOT_APPROVED");
    expect(indexer.uploads).toBe(0);
  });

  it("refuses to upload without a usable signing key, and never reaches the network", async () => {
    const indexer = spyIndexer();
    const subject = new ZeroGStorage({
      indexerUrl: "https://indexer.invalid",
      chainRpcUrl: "https://rpc.invalid",
      network: NETWORK,
      privateKeyProvider: () => undefined,
      indexerFactory: () => indexer,
    });
    await expect(subject.upload(BYTES, await contextFor(BYTES), new AbortController().signal)).rejects.toThrow("SIGNER_UNAVAILABLE");
    expect(indexer.uploads).toBe(0);
  });

  it("reports proofValid false when returned bytes do not re-derive the requested root", async () => {
    const corrupting = spyIndexer({
      async downloadToBlob(): Promise<[{ arrayBuffer(): Promise<ArrayBuffer> }, Error | null]> {
        const tampered = new TextEncoder().encode('{"hello":"tampered"}');
        return [{ async arrayBuffer() { return tampered.buffer.slice(0) as ArrayBuffer; } }, null];
      },
    });
    const subject = storage(corrupting);
    const root = await subject.computeRoot(BYTES);
    const result = await subject.download(root, new AbortController().signal);
    expect(result.proofValid).toBe(false);
  });

  it("confirms proofValid when the returned bytes re-derive the requested root", async () => {
    const subject = storage(spyIndexer());
    const root = await subject.computeRoot(BYTES);
    const result = await subject.download(root, new AbortController().signal);
    expect(result.proofValid).toBe(true);
    expect(Buffer.compare(Buffer.from(result.bytes), Buffer.from(BYTES))).toBe(0);
  });

  it("aborts before doing any outward work when the signal is already aborted", async () => {
    const indexer = spyIndexer();
    const controller = new AbortController();
    controller.abort();
    await expect(storage(indexer).download("0x" + "ab".repeat(32) as `0x${string}`, controller.signal)).rejects.toThrow("ABORTED");
    expect(indexer.downloads).toBe(0);
  });
});
