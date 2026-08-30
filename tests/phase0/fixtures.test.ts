import { describe, expect, it } from "vitest";
import { FixtureSchema, canonicalHash } from "../../packages/contracts/src/index.js";
import { fixtureCatalog, fixtureCatalogMetadata } from "../../fixtures/v1/catalog.js";

describe("independent fixture oracle catalog", () => {
  it("contains exactly five planted attacks, one clean case, and one policy fix", () => {
    expect(fixtureCatalog).toHaveLength(7);
    expect(new Set(fixtureCatalog.map((fixture) => fixture.family))).toEqual(new Set(["prompt-injection", "recipient-swap", "replay", "concurrency", "recursive-tool", "clean", "policy-fix"]));
    expect(fixtureCatalogMetadata.fixtureCount).toBe(7);
  });

  it("is schema-valid and content-addressable", () => {
    for (const fixture of fixtureCatalog) FixtureSchema.parse(fixture);
    expect(canonicalHash(fixtureCatalog)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("freezes exact nonzero attack losses and zero clean/fixed losses", () => {
    const expected = new Map([
      ["prompt-injection", "27500000"],
      ["recipient-swap", "25000000"],
      ["replay", "20000000"],
      ["concurrency", "60000000"],
      ["recursive-tool", "40000000"],
      ["clean", "0"],
      ["policy-fix", "0"],
    ]);
    for (const fixture of fixtureCatalog) expect(fixture.oracle.maximumLossBaseUnits).toBe(expected.get(fixture.fixtureId));
  });

  it("binds every attacker path to an adversarial sink and every path action to the manifest", () => {
    for (const fixture of fixtureCatalog) {
      expect(fixture.adversarialRecipients).toContain("attacker");
      const actionIds = new Set(fixture.manifest.actions.map((action) => action.id));
      for (const trajectory of fixture.candidateTrajectories) for (const transitionId of trajectory) expect(actionIds.has(transitionId)).toBe(true);
      for (const transitionId of fixture.oracle.shortestPathTransitionIds) expect(actionIds.has(transitionId)).toBe(true);
      for (const transitionId of fixture.oracle.blockedTransitionIds) expect(actionIds.has(transitionId)).toBe(true);
    }
  });
});
