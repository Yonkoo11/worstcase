import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildDemoArtifacts } from "../../apps/web/scripts/demo-artifacts.js";
import { formatMoney, resultHeadline, shortHash } from "../../apps/web/src/view-model.js";

describe("production web artifact contract", () => {
  it("checked-in browser data exactly matches fresh compiler/checker output", async () => {
    const bytes = await readFile(new URL("../../apps/web/src/generated/demo-artifacts.json", import.meta.url), "utf8");
    expect(JSON.parse(bytes)).toEqual(buildDemoArtifacts());
  });

  it("contains the complete seven-fixture corpus with truthful local provenance", () => {
    const artifacts = buildDemoArtifacts();
    expect(artifacts).toHaveLength(7);
    expect(artifacts.every((artifact) => artifact.origin === "LOCAL_FIXTURE")).toBe(true);
    expect(artifacts.filter((artifact) => BigInt(artifact.result.maximumLossBaseUnits ?? "0") > 0n)).toHaveLength(5);
    expect(artifacts.find((artifact) => artifact.fixtureId === "clean")?.result.maximumLossBaseUnits).toBe("0");
    expect(artifacts.find((artifact) => artifact.fixtureId === "policy-fix")?.result.blocked).toHaveLength(5);
  });

  it("only claims an on-chain anchor when a verified record backs the exact displayed loss", async () => {
    const artifacts = buildDemoArtifacts();
    for (const artifact of artifacts) {
      const anchor = artifact.anchor;
      if (anchor === undefined) continue;

      // A displayed anchor must point at a real, well-formed transaction.
      expect(anchor.anchorTx).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(anchor.runRegistry).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(anchor.explorerTx).toContain(anchor.anchorTx);
      expect(anchor.explorerContract).toContain(anchor.runRegistry);

      // The recorded loss must still equal what the engine computes today, so a
      // changed model can never keep an anchor badge from an older result.
      const raw = await readFile(new URL(`../../contracts/deployments/${anchor.chainId}-anchor-${artifact.fixtureId}.json`, import.meta.url), "utf8");
      const record = JSON.parse(raw) as { maximumLossBaseUnits: string; bundleRoot: string };
      expect(record.maximumLossBaseUnits).toBe(artifact.result.maximumLossBaseUnits ?? "0");
      expect(record.bundleRoot).toBe(artifact.bundleRoot);
    }
  });

  it("only claims a 0G Storage upload when the record proves a verified round trip", async () => {
    for (const artifact of buildDemoArtifacts()) {
      const store = artifact.storage;
      if (store === undefined) continue;

      expect(store.storageRoot).toMatch(/^0x[0-9a-f]{64}$/);

      // Either a real transaction exists, or the upload was deduplicated and the
      // interface must not offer a transaction link at all. Never an empty link.
      if (store.alreadyStored) {
        expect(store.storageTx).toBeNull();
        expect(store.explorerTx).toBeNull();
      } else {
        expect(store.storageTx).toMatch(/^0x[0-9a-f]{64}$/i);
        expect(store.explorerTx).toContain(store.storageTx as string);
      }

      // The interface says "uploaded and re-verified". It may only say that if
      // the recorded upload actually downloaded back to identical bytes.
      expect(store.proofValid).toBe(true);
      expect(store.bytesMatch).toBe(true);

      const raw = await readFile(new URL(`../../contracts/deployments/${store.chainId}-storage-${artifact.fixtureId}.json`, import.meta.url), "utf8");
      const record = JSON.parse(raw) as { storageRoot: string; verified: { proofValid: boolean; bytesMatch: boolean } };
      expect(record.storageRoot).toBe(store.storageRoot);
      expect(record.verified.proofValid).toBe(true);
      expect(record.verified.bytesMatch).toBe(true);
    }
  });

  it("formats base-unit money without floating point arithmetic", () => {
    expect(formatMoney("27500000", 6)).toBe("27.5");
    expect(formatMoney("100000000", 6)).toBe("100");
    expect(formatMoney("1", 6)).toBe("0.000001");
    expect(formatMoney("42", 0)).toBe("42");
    expect(formatMoney("27500000", 6, 2)).toBe("27.50");
    expect(formatMoney("0", 6, 2)).toBe("0.00");
  });

  it("never presents zero loss as UNKNOWN", () => {
    const fixed = buildDemoArtifacts().find((artifact) => artifact.fixtureId === "policy-fix");
    expect(fixed).toBeDefined();
    if (fixed === undefined) return;
    expect(resultHeadline(fixed)).toBe("No loss reaches the declared sink.");
  });

  it("shortens hashes without changing their identifying ends", () => {
    expect(shortHash("0x1234567890abcdef")).toBe("0x123456…abcdef");
  });
});
