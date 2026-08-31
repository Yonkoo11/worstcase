import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileModel } from "../../packages/compiler/src/index.js";
import { searchMaximumLoss } from "../../packages/checker/src/index.js";

/**
 * The shipped example must keep working, because it is the first thing anyone
 * runs. These assertions are derived by hand from the example files, not copied
 * from engine output.
 */
const read = (name: string) => JSON.parse(readFileSync(new URL(`../../examples/${name}`, import.meta.url), "utf8")) as unknown;

describe("checking an agent that is not in the fixture catalog", () => {
  it("finds the reachable loss in the example agent", () => {
    const compiled = compileModel(read("agent-manifest.json"), read("spend-policy.json"));
    expect(compiled.status).toBe("SUPPORTED");
    if (compiled.status !== "SUPPORTED") return;

    const result = searchMaximumLoss(compiled, ["unknown-vendor"]);
    expect(result.status).toBe("COMPLETE");
    if (result.status !== "COMPLETE") return;

    // Only pay-unknown-vendor reaches the declared adversarial recipient, and it
    // is 45 USDC, under both the 50 per-action cap and the 100 balance.
    expect(result.maximumLossBaseUnits).toBe("45000000");
    expect(result.shortestPathTransitionIds).toEqual(["pay-unknown-vendor"]);
  });

  it("reaches zero once the recipient is removed from the policy", () => {
    const compiled = compileModel(read("agent-manifest.json"), read("spend-policy-fixed.json"));
    expect(compiled.status).toBe("SUPPORTED");
    if (compiled.status !== "SUPPORTED") return;

    const result = searchMaximumLoss(compiled, ["unknown-vendor"]);
    expect(result.status).toBe("COMPLETE");
    if (result.status !== "COMPLETE") return;

    expect(result.maximumLossBaseUnits).toBe("0");
    expect(result.shortestPathTransitionIds).toEqual([]);
    expect(result.blocked.map((b) => `${b.transitionId}:${b.policyCheckId}`)).toEqual(["pay-unknown-vendor:recipient-not-allowed"]);
  });

  it("returns UNKNOWN rather than a low number when the budget is too small to finish", () => {
    const compiled = compileModel(read("agent-manifest.json"), read("spend-policy.json"), {
      maxDepth: 64, maxStates: 1, maxBranches: 64, maxConcurrency: 8, timeoutMs: 10_000,
    });
    expect(compiled.status).toBe("SUPPORTED");
    if (compiled.status !== "SUPPORTED") return;

    const result = searchMaximumLoss(compiled, ["unknown-vendor"]);
    expect(result.status).toBe("UNKNOWN");
    expect("maximumLossBaseUnits" in result).toBe(false);
  });
});
