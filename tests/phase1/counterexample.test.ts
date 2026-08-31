import { describe, expect, it } from "vitest";
import { checkFixture } from "../../packages/checker/src/index.js";
import { compileModel, DEFAULT_LIMITS } from "../../packages/compiler/src/index.js";
import { fixtureCatalog } from "../../fixtures/v1/catalog.js";

function compile(fixture: (typeof fixtureCatalog)[number], changes: Partial<typeof DEFAULT_LIMITS> = {}) {
  const compiled = compileModel(fixture.manifest, fixture.policy, { ...DEFAULT_LIMITS, ...changes });
  if (compiled.status !== "SUPPORTED") throw new Error("fixture unsupported");
  return compiled;
}

describe("counterexample ordering", () => {
  it("selects maximum loss before path length", () => {
    // The replay agent can lose 10M in one step or 20M in two. The larger loss
    // wins even though its path is longer.
    const source = fixtureCatalog[2];
    const result = checkFixture(compile(source), source);
    expect(result.status).toBe("COMPLETE");
    if (result.status === "COMPLETE") {
      expect(result.maximumLossBaseUnits).toBe("20000000");
      expect(result.shortestPathTransitionIds).toEqual(["replay-one", "replay-two"]);
    }
  });

  it("selects the shorter path for equal maximum loss", () => {
    // Paying the merchant first reaches the same 27.5M loss in two steps.
    // The one-step path is the counterexample worth showing.
    const source = fixtureCatalog[0];
    const result = checkFixture(compile(source), source);
    expect(result.status).toBe("COMPLETE");
    if (result.status === "COMPLETE") {
      expect(result.maximumLossBaseUnits).toBe("27500000");
      expect(result.shortestPathTransitionIds).toEqual(["pay-attacker"]);
    }
  });

  it("uses lexical transition order for equal loss and length", () => {
    // Tighten the concurrency agent so the spawn is disallowed and the budget
    // admits only one of the two identical 30M payments. Both candidates then
    // tie on loss and on length, so the tie-break must be deterministic.
    const source = fixtureCatalog[3];
    const tied: Record<string, unknown> = structuredClone(source);
    tied["policy"] = { ...(structuredClone(source.policy) as Record<string, unknown>), cumulativeCaps: { usdc: "30000000" }, maxConcurrency: 1 };
    const compiled = compileModel(tied["manifest"], tied["policy"]);
    if (compiled.status !== "SUPPORTED") throw new Error("fixture unsupported");
    const result = checkFixture(compiled, tied);
    expect(result.status).toBe("COMPLETE");
    if (result.status === "COMPLETE") {
      expect(result.maximumLossBaseUnits).toBe("30000000");
      expect(result.shortestPathTransitionIds).toEqual(["parallel-a"]);
    }
  });
});
