import { describe, expect, it } from "vitest";
import { checkFixture } from "../../packages/checker/src/index.js";
import { compileModel } from "../../packages/compiler/src/index.js";
import { fixtureCatalog } from "../../fixtures/v1/catalog.js";

describe("counterexample ordering", () => {
  it("selects maximum loss before path length", () => {
    const source = fixtureCatalog[0];
    const fixture = { ...structuredClone(source), candidateTrajectories: [["swap-attacker"], ["pay-merchant", "pay-attacker"]] };
    const compiled = compileModel(fixture.manifest, fixture.policy);
    if (compiled.status !== "SUPPORTED") throw new Error("fixture unsupported");
    const result = checkFixture(compiled, fixture);
    expect(result.status).toBe("COMPLETE");
    if (result.status === "COMPLETE") {
      expect(result.maximumLossBaseUnits).toBe("27500000");
      expect(result.shortestPathTransitionIds).toEqual(["pay-merchant", "pay-attacker"]);
    }
  });

  it("selects the shorter path for equal maximum loss", () => {
    const source = fixtureCatalog[0];
    const fixture = { ...structuredClone(source), candidateTrajectories: [["pay-merchant", "pay-attacker"], ["pay-attacker"]] };
    const compiled = compileModel(fixture.manifest, fixture.policy);
    if (compiled.status !== "SUPPORTED") throw new Error("fixture unsupported");
    const result = checkFixture(compiled, fixture);
    expect(result.status).toBe("COMPLETE");
    if (result.status === "COMPLETE") expect(result.shortestPathTransitionIds).toEqual(["pay-attacker"]);
  });

  it("uses lexical transition order for equal loss and length", () => {
    const source = fixtureCatalog[3];
    const fixture = { ...structuredClone(source), candidateTrajectories: [["parallel-b"], ["parallel-a"]] };
    const compiled = compileModel(fixture.manifest, fixture.policy);
    if (compiled.status !== "SUPPORTED") throw new Error("fixture unsupported");
    const result = checkFixture(compiled, fixture);
    expect(result.status).toBe("COMPLETE");
    if (result.status === "COMPLETE") expect(result.shortestPathTransitionIds).toEqual(["parallel-a"]);
  });
});
