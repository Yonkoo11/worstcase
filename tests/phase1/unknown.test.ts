import { describe, expect, it } from "vitest";
import { checkFixture } from "../../packages/checker/src/index.js";
import { compileModel, DEFAULT_LIMITS } from "../../packages/compiler/src/index.js";
import { fixtureCatalog } from "../../fixtures/v1/catalog.js";

function compileWith(fixture: (typeof fixtureCatalog)[number], changes: Partial<typeof DEFAULT_LIMITS>) {
  const compiled = compileModel(fixture.manifest, fixture.policy, { ...DEFAULT_LIMITS, ...changes });
  if (compiled.status !== "SUPPORTED") throw new Error("fixture unsupported");
  return compiled;
}

describe("incomplete exploration is never zero loss", () => {
  it("reports every enforced exploration bound explicitly", () => {
    // A truncated search must say so. Returning the best value found so far
    // would understate the bound, which is the one error this tool cannot make.
    const twoTrajectories = { ...structuredClone(fixtureCatalog[2]) as Record<string, unknown>, candidateTrajectories: [["replay-one"], ["replay-two"]] };
    expect(checkFixture(compileWith(fixtureCatalog[2], { maxBranches: 1 }), twoTrajectories)).toMatchObject({ status: "UNKNOWN", unknownReason: "MAX_BRANCHES" });
    expect(checkFixture(compileWith(fixtureCatalog[4], { maxStates: 1 }), fixtureCatalog[4])).toMatchObject({ status: "UNKNOWN", unknownReason: "MAX_STATES" });
    expect(checkFixture(compileWith(fixtureCatalog[0], { maxDepth: 1 }), fixtureCatalog[0])).toMatchObject({ status: "UNKNOWN", unknownReason: "MAX_DEPTH" });
    expect(checkFixture(compileWith(fixtureCatalog[3], { maxConcurrency: 1 }), fixtureCatalog[3])).toMatchObject({ status: "UNKNOWN", unknownReason: "MAX_CONCURRENCY" });
  });

  it("reports a deterministic timeout without a monetary result", () => {
    const compiled = compileWith(fixtureCatalog[0], { timeoutMs: 10 });
    let tick = 0;
    const result = checkFixture(compiled, fixtureCatalog[0], { now: () => (tick++ === 0 ? 0 : 10) });
    expect(result).toEqual({ status: "UNKNOWN", unknownReason: "TIMEOUT", exploredStates: 1, exploredTrajectories: 0 });
    expect("maximumLossBaseUnits" in result).toBe(false);
  });

  it("does not lower the bound when a declared trajectory is removed", () => {
    // The regression this suite exists for. The checker previously replayed
    // `candidateTrajectories` and reported the best of them, so deleting the
    // trajectory that happened to describe the attack silently reduced the
    // reported maximum loss. The bound is a property of the model, so stripping
    // the declared paths must change nothing.
    const source = fixtureCatalog[2];
    const compiled = compileModel(source.manifest, source.policy);
    if (compiled.status !== "SUPPORTED") throw new Error("fixture unsupported");

    const withDeclared = checkFixture(compiled, source);
    const withMinimalDeclared = checkFixture(compiled, { ...structuredClone(source) as Record<string, unknown>, candidateTrajectories: [["replay-one"]] });

    expect(withDeclared.status).toBe("COMPLETE");
    expect(withMinimalDeclared).toEqual(withDeclared);
    if (withMinimalDeclared.status === "COMPLETE") {
      // Both replay submissions are still found even though only one was declared.
      expect(withMinimalDeclared.maximumLossBaseUnits).toBe("20000000");
    }
  });

  it("finds a drain that no declared trajectory describes", () => {
    const source = fixtureCatalog[0];
    const compiled = compileModel(source.manifest, source.policy);
    if (compiled.status !== "SUPPORTED") throw new Error("fixture unsupported");
    const result = checkFixture(compiled, { ...structuredClone(source) as Record<string, unknown>, candidateTrajectories: [["pay-merchant"]] });
    expect(result.status).toBe("COMPLETE");
    if (result.status === "COMPLETE") {
      expect(result.maximumLossBaseUnits).toBe("27500000");
      expect(result.shortestPathTransitionIds).toEqual(["pay-attacker"]);
    }
  });
});
