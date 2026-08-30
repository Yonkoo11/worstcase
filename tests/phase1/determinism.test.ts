import { describe, expect, it } from "vitest";
import { checkFixture } from "../../packages/checker/src/index.js";
import { compileModel } from "../../packages/compiler/src/index.js";
import { fixtureCatalog } from "../../fixtures/v1/catalog.js";

describe("deterministic compiler and checker", () => {
  it("returns byte-equivalent identities and results across repeated runs", () => {
    for (const fixture of fixtureCatalog) {
      const first = compileModel(structuredClone(fixture.manifest), structuredClone(fixture.policy));
      const second = compileModel(structuredClone(fixture.manifest), structuredClone(fixture.policy));
      expect(first.status).toBe("SUPPORTED");
      expect(second.status).toBe("SUPPORTED");
      if (first.status !== "SUPPORTED" || second.status !== "SUPPORTED") continue;
      expect({ compilationId: first.compilationId, graphHash: first.graphHash, manifestHash: first.manifestHash, policyHash: first.policyHash }).toEqual({ compilationId: second.compilationId, graphHash: second.graphHash, manifestHash: second.manifestHash, policyHash: second.policyHash });
      expect(checkFixture(first, fixture)).toEqual(checkFixture(second, fixture));
    }
  });

  it("returns explicit unsupported issues instead of inventing semantics", () => {
    const fixture = fixtureCatalog[0];
    const manifest = structuredClone(fixture.manifest) as typeof fixture.manifest & { unsupported: Array<{ path: string; reason: string }> };
    manifest.unsupported.push({ path: "/tools/0/inputSchema", reason: "dynamic amount expression is not supported" });
    const result = compileModel(manifest, fixture.policy);
    expect(result.status).toBe("UNSUPPORTED");
    if (result.status === "UNSUPPORTED") expect(result.issues).toEqual([{ path: "/tools/0/inputSchema", code: "DECLARED_UNSUPPORTED", message: "dynamic amount expression is not supported" }]);
  });
});
