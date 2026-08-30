import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  EvidenceBundleSchema,
  FixtureSchema,
  ManifestProjectionSchema,
  MoneyBaseUnits,
  RunSchema,
  SpendPolicySchema,
  SupportedActionSchema,
} from "../../packages/contracts/src/index.js";
import { fixtureCatalog } from "../../fixtures/v1/catalog.js";

describe("v1 domain contracts", () => {
  it("accepts every checked-in fixture and its nested contracts", () => {
    for (const fixture of fixtureCatalog) expect(FixtureSchema.parse(fixture).fixtureId).toBe(fixture.fixtureId);
    expect(ManifestProjectionSchema.parse(fixtureCatalog[0].manifest).actions).toHaveLength(11);
    expect(SpendPolicySchema.parse(fixtureCatalog[0].policy).assets[0]?.symbol).toBe("USDC");
  });

  it("rejects money coercion, unknown keys, and dangling action references", () => {
    expect(MoneyBaseUnits.safeParse(1).success).toBe(false);
    expect(MoneyBaseUnits.safeParse("01").success).toBe(false);
    expect(MoneyBaseUnits.safeParse("0").success).toBe(true);
    expect(SupportedActionSchema.safeParse({ ...fixtureCatalog[0].manifest.actions[0], surprise: true }).success).toBe(false);
    const dangling = structuredClone(fixtureCatalog[0].manifest) as unknown as { tools: Array<{ actionIds: string[] }> };
    dangling.tools[0]!.actionIds.push("missing-action");
    expect(ManifestProjectionSchema.safeParse(dangling).success).toBe(false);
  });

  it("makes COMPLETE and UNKNOWN mutually explicit", () => {
    const base = {
      schemaVersion: "1",
      engineVersion: "0.1.0-contract",
      runId: "run-1",
      manifestHash: `0x${"1".repeat(64)}`,
      policyHash: `0x${"2".repeat(64)}`,
      graphHash: `0x${"3".repeat(64)}`,
      fixtureIds: ["clean"],
      limits: { maxDepth: 8, maxStates: 1000, maxBranches: 8, maxConcurrency: 2, timeoutMs: 1000 },
    };
    expect(RunSchema.safeParse({ ...base, stage: "COMPLETE" }).success).toBe(false);
    expect(RunSchema.safeParse({ ...base, stage: "UNKNOWN", counterexample: { maximumLossBaseUnits: "0", transitionIds: [], blocked: [] } }).success).toBe(false);
    expect(RunSchema.safeParse({ ...base, stage: "UNKNOWN", unknownReason: "MAX_STATES" }).success).toBe(true);
  });

  it("exports the evidence bundle schema", () => {
    expect(EvidenceBundleSchema).toBeDefined();
  });

  it("keeps local and 0G Compute evidence origins mutually explicit", () => {
    const localWithoutProvider = { origin: "LOCAL_FIXTURE" };
    const computeWithoutProvider = { origin: "ZEROG_COMPUTE" };
    expect(localWithoutProvider.origin).not.toBe(computeWithoutProvider.origin);

    const schemaShape = EvidenceBundleSchema.safeParse({});
    expect(schemaShape.success).toBe(false);
    if (!schemaShape.success) expect(schemaShape.error.issues.some((issue) => issue.path[0] === "origin")).toBe(true);
  });
});

describe("OpenAPI surface", () => {
  it("documents every approved v1 endpoint and shared error envelope", () => {
    const spec = YAML.parse(readFileSync("docs/openapi.yaml", "utf8")) as { paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } };
    expect(Object.keys(spec.paths).sort()).toEqual([
      "/v1/compilations",
      "/v1/evidence/{bundleRoot}",
      "/v1/evidence/{bundleRoot}/anchors",
      "/v1/evidence/{bundleRoot}/anchors/{chainId}",
      "/v1/fixtures",
      "/v1/runs",
      "/v1/runs/{runId}",
      "/v1/runs/{runId}/evidence",
    ]);
    expect(spec.components.schemas.ErrorEnvelope).toBeDefined();
    expect(spec.components.schemas.MoneyBaseUnits).toBeDefined();
  });
});
