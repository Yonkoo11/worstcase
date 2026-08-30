import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkFixture } from "../../packages/checker/src/index.js";
import { compileModel } from "../../packages/compiler/src/index.js";
import { fixtureCatalog } from "../../fixtures/v1/catalog.js";

describe("offline checker isolation", () => {
  it("contains no network, signer, environment, shell, or host-filesystem capability", () => {
    const source = readFileSync("packages/checker/src/index.ts", "utf8");
    for (const forbidden of ["node:fs", "node:http", "node:https", "node:net", "node:tls", "child_process", "process.env", "fetch(", "ethers", "Wallet", "privateKey"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("computes the fixed suite even when ambient fetch throws", () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error("network access denied"); }) as typeof fetch;
    try {
      for (const fixture of fixtureCatalog) {
        const compiled = compileModel(fixture.manifest, fixture.policy);
        if (compiled.status !== "SUPPORTED") throw new Error("fixture unsupported");
        expect(checkFixture(compiled, fixture).status).toBe("COMPLETE");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
