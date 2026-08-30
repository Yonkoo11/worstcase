import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildDemoArtifacts } from "../../apps/web/scripts/demo-artifacts.js";
import { formatMoney, resultHeadline, shortHash } from "../../apps/web/src/view-model.js";

describe("production web artifact contract", () => {
  it("checked-in browser data exactly matches fresh compiler/checker output", async () => {
    const bytes = await readFile(new URL("../../apps/web/src/generated/demo-artifacts.json", import.meta.url), "utf8");
    expect(JSON.parse(bytes)).toEqual(buildDemoArtifacts());
  });

  it("contains the complete seven-fixture corpus with truthful local provenance", () => {
    const artifacts = buildDemoArtifacts();
    expect(artifacts).toHaveLength(7);
    expect(artifacts.every((artifact) => artifact.origin === "LOCAL_FIXTURE")).toBe(true);
    expect(artifacts.filter((artifact) => BigInt(artifact.result.maximumLossBaseUnits ?? "0") > 0n)).toHaveLength(5);
    expect(artifacts.find((artifact) => artifact.fixtureId === "clean")?.result.maximumLossBaseUnits).toBe("0");
    expect(artifacts.find((artifact) => artifact.fixtureId === "policy-fix")?.result.blocked).toHaveLength(5);
  });

  it("formats base-unit money without floating point arithmetic", () => {
    expect(formatMoney("27500000", 6)).toBe("27.5");
    expect(formatMoney("100000000", 6)).toBe("100");
    expect(formatMoney("1", 6)).toBe("0.000001");
    expect(formatMoney("42", 0)).toBe("42");
    expect(formatMoney("27500000", 6, 2)).toBe("27.50");
    expect(formatMoney("0", 6, 2)).toBe("0.00");
  });

  it("never presents zero loss as UNKNOWN", () => {
    const fixed = buildDemoArtifacts().find((artifact) => artifact.fixtureId === "policy-fix");
    expect(fixed).toBeDefined();
    if (fixed === undefined) return;
    expect(resultHeadline(fixed)).toBe("No loss reaches the declared sink.");
  });

  it("shortens hashes without changing their identifying ends", () => {
    expect(shortHash("0x1234567890abcdef")).toBe("0x123456…abcdef");
  });
});
