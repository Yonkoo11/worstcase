import { describe, expect, it } from "vitest";
import { checkFixture } from "../../packages/checker/src/index.js";
import { compileModel } from "../../packages/compiler/src/index.js";
import { fixtureCatalog } from "../../fixtures/v1/catalog.js";

describe("exact Phase 1 fixture oracle", () => {
  for (const fixture of fixtureCatalog) {
    it(`${fixture.fixtureId} matches its independent amount and path oracle`, () => {
      const compiled = compileModel(fixture.manifest, fixture.policy);
      expect(compiled.status).toBe("SUPPORTED");
      if (compiled.status !== "SUPPORTED") return;
      const result = checkFixture(compiled, fixture);
      expect(result.status).toBe(fixture.oracle.status);
      if (result.status !== "COMPLETE") return;
      expect(result.maximumLossBaseUnits).toBe(fixture.oracle.maximumLossBaseUnits);
      expect(result.shortestPathTransitionIds).toEqual(fixture.oracle.shortestPathTransitionIds);
      expect(result.blocked.map((item) => item.transitionId)).toEqual([...fixture.oracle.blockedTransitionIds].sort());
    });
  }

  it("detects all five planted drains while clean and fixed cases remain zero", () => {
    const amounts = fixtureCatalog.map((fixture) => {
      const compiled = compileModel(fixture.manifest, fixture.policy);
      if (compiled.status !== "SUPPORTED") throw new Error("fixture unexpectedly unsupported");
      const result = checkFixture(compiled, fixture);
      if (result.status !== "COMPLETE") throw new Error("fixture unexpectedly unknown");
      return [fixture.family, BigInt(result.maximumLossBaseUnits)] as const;
    });
    expect(amounts.filter(([family, amount]) => !["clean", "policy-fix"].includes(family) && amount > 0n)).toHaveLength(5);
    expect(amounts.find(([family]) => family === "clean")?.[1]).toBe(0n);
    expect(amounts.find(([family]) => family === "policy-fix")?.[1]).toBe(0n);
  });
});
