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
    expect(checkFixture(compileWith(fixtureCatalog[6], { maxBranches: 1 }), fixtureCatalog[6])).toMatchObject({ status: "UNKNOWN", unknownReason: "MAX_BRANCHES" });
    expect(checkFixture(compileWith(fixtureCatalog[4], { maxStates: 1 }), fixtureCatalog[4])).toMatchObject({ status: "UNKNOWN", unknownReason: "MAX_STATES" });
    expect(checkFixture(compileWith(fixtureCatalog[0], { maxDepth: 1 }), fixtureCatalog[0])).toMatchObject({ status: "UNKNOWN", unknownReason: "MAX_DEPTH" });
    expect(checkFixture(compileWith(fixtureCatalog[3], { maxConcurrency: 1 }), fixtureCatalog[3])).toMatchObject({ status: "UNKNOWN", unknownReason: "MAX_CONCURRENCY" });
  });

  it("reports a deterministic timeout without a monetary result", () => {
    const compiled = compileWith(fixtureCatalog[0], { timeoutMs: 10 });
    let tick = 0;
    const result = checkFixture(compiled, fixtureCatalog[0], { now: () => (tick++ === 0 ? 0 : 10) });
    expect(result).toEqual({ status: "UNKNOWN", unknownReason: "TIMEOUT", exploredStates: 0, exploredTrajectories: 1 });
    expect("maximumLossBaseUnits" in result).toBe(false);
  });

  it("rejects a trajectory action outside the compiled graph", () => {
    const source = fixtureCatalog[0];
    const fixture = { ...structuredClone(source), candidateTrajectories: [["provider-invented-action"]] };
    const compiled = compileWith(source, {});
    expect(checkFixture(compiled, fixture)).toMatchObject({ status: "UNKNOWN", unknownReason: "PROVIDER_EVIDENCE_INVALID" });
  });
});
