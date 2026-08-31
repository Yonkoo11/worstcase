/**
 * Live 0G Storage adapter behind the existing StoragePort boundary.
 *
 * The vendor SDK is admitted only with `ws`, `axios` and `ethers` pinned past
 * their advisories through workspace overrides; see reports/0g-sdk-dependency-risk.md
 * for the review that gated this. `npm audit` must stay at zero for this file to
 * be a legitimate integration rather than a regression.
 *
 * The signer key is read from the process environment at call time and is never
 * read from a file, logged, or returned. Upload is a mutation and therefore
 * refuses to run without a scoped, unexpired approval bound to the exact bytes.
 */
import { Indexer, MemData } from "@0gfoundation/0g-storage-ts-sdk";
import { ethers } from "ethers";
import { assertWriteApproval, type MutationContext, type StoragePort } from "./index.js";

export type ZeroGStorageConfig = Readonly<{
  indexerUrl: string;
  chainRpcUrl: string;
  network: string;
  /** Reads the signing key at call time. Defaults to process.env.PRIVATE_KEY. */
  privateKeyProvider?: () => string | undefined;
  /** Injection seam for tests; defaults to the real vendor Indexer. */
  indexerFactory?: (url: string) => StorageIndexer;
}>;

/** The narrow slice of the vendor Indexer this adapter actually depends on. */
export type StorageIndexer = {
  upload(file: unknown, rpc: string, signer: unknown): Promise<[unknown, Error | null]>;
  downloadToBlob(root: string, opts?: { proof?: boolean }): Promise<[{ arrayBuffer(): Promise<ArrayBuffer> }, Error | null]>;
};

function hex32(value: string): `0x${string}` {
  const normalized = value.startsWith("0x") ? value.toLowerCase() : `0x${value.toLowerCase()}`;
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) throw new Error("STORAGE_ROOT_MALFORMED");
  return normalized as `0x${string}`;
}

export class ZeroGStorage implements StoragePort {
  readonly #config: ZeroGStorageConfig;

  constructor(config: ZeroGStorageConfig) {
    this.#config = config;
  }

  #indexer(): StorageIndexer {
    // ethers ships dual ESM/CJS builds, so the vendor Indexer's declared Signer
    // is nominally distinct from our ESM Wallet even though the runtime object
    // is identical. StorageIndexer bridges that without weakening to `any`.
    return (this.#config.indexerFactory ?? ((url: string) => new Indexer(url) as unknown as StorageIndexer))(this.#config.indexerUrl);
  }

  #signer(): ethers.Wallet {
    const key = (this.#config.privateKeyProvider ?? (() => process.env["PRIVATE_KEY"]))();
    if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? "")) throw new Error("SIGNER_UNAVAILABLE");
    return new ethers.Wallet(key as string, new ethers.JsonRpcProvider(this.#config.chainRpcUrl));
  }

  /** Local Merkle computation. No network call and no signer, so it stays outside the approval boundary. */
  async computeRoot(bytes: Uint8Array): Promise<`0x${string}`> {
    const [tree, error] = await new MemData(bytes).merkleTree();
    if (error !== null || tree === null) throw new Error("STORAGE_ROOT_FAILED");
    const root = tree.rootHash();
    if (root === null || root === undefined) throw new Error("STORAGE_ROOT_FAILED");
    return hex32(String(root));
  }

  async upload(bytes: Uint8Array, context: MutationContext, signal: AbortSignal): Promise<{ root: `0x${string}`; transactionId: string }> {
    // Fail closed before any outward action: wrong scope, wrong network, or an
    // expired approval must never reach the vendor SDK.
    assertWriteApproval(context, "STORAGE_UPLOAD", `bundle:${context.canonicalRequestHash}`, this.#config.network);
    if (signal.aborted) throw new Error("ABORTED");

    const file = new MemData(bytes);
    const expectedRoot = await this.computeRoot(bytes);

    const [result, error] = await this.#indexer().upload(file, this.#config.chainRpcUrl, this.#signer());
    if (error !== null) throw new Error("STORAGE_UPLOAD_FAILED");

    const record = Array.isArray(result) ? result[0] : result;
    const rootHash = (record as { rootHash?: string } | undefined)?.rootHash;
    const txHash = (record as { txHash?: string } | undefined)?.txHash;
    if (rootHash === undefined || txHash === undefined) throw new Error("STORAGE_UPLOAD_INCOMPLETE");

    // 0G Storage is content addressed, so re-uploading identical bytes is a
    // no-op that returns an empty transaction hash. That is a success, not a
    // failure, but callers must not fabricate a transaction link for it.

    // The network must not be able to rebind our bytes to a different root.
    if (hex32(rootHash) !== expectedRoot) throw new Error("STORAGE_ROOT_MISMATCH");
    return { root: expectedRoot, transactionId: txHash };
  }

  async download(root: `0x${string}`, signal: AbortSignal): Promise<{ bytes: Uint8Array; proofValid: boolean }> {
    if (signal.aborted) throw new Error("ABORTED");
    const [blob, error] = await this.#indexer().downloadToBlob(root, { proof: true });
    if (error !== null) throw new Error("STORAGE_DOWNLOAD_FAILED");

    const bytes = new Uint8Array(await blob.arrayBuffer());

    // Proof verification by the SDK is necessary but not sufficient: re-derive the
    // root from the returned bytes so corrupted content cannot pass as verified.
    const rederived = await this.computeRoot(bytes);
    return { bytes, proofValid: rederived === root };
  }
}
