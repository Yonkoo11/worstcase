import { describe, expect, it } from "vitest";
import { fixtureCatalog } from "../../fixtures/v1/catalog.js";
import { checkFixture } from "../../packages/checker/src/index.js";
import { compileModel } from "../../packages/compiler/src/index.js";
import { FixtureSchema, canonicalHash, canonicalJson, type EvidenceBundle } from "../../packages/contracts/src/index.js";
import { createLocalEvidenceBundle, replayEvidenceBundle } from "../../packages/evidence/src/index.js";

function makeEvidence(index = 0) {
  const fixture = FixtureSchema.parse(fixtureCatalog[index]);
  const compiled = compileModel(fixture.manifest, fixture.policy);
  if (compiled.status !== "SUPPORTED") throw new Error("fixture unexpectedly unsupported");
  return createLocalEvidenceBundle(compiled, fixture, checkFixture(compiled, fixture));
}

describe("canonical evidence replay", () => {
  it("reconstructs a complete result from canonical bytes", () => {
    const evidence = makeEvidence();
    const replay = replayEvidenceBundle(evidence.bytes, evidence.bundleRoot);
    expect(replay).toMatchObject({ verified: true, bundleRoot: evidence.bundleRoot });
    if (replay.verified) expect(replay.run.counterexample?.maximumLossBaseUnits).toBe("27500000");
  });

  it("reconstructs a zero-loss result without treating it as UNKNOWN", () => {
    const evidence = makeEvidence(5);
    const replay = replayEvidenceBundle(evidence.bytes, evidence.bundleRoot);
    expect(replay.verified).toBe(true);
    if (replay.verified) {
      expect(replay.run.stage).toBe("COMPLETE");
      expect(replay.run.counterexample?.maximumLossBaseUnits).toBe("0");
    }
  });

  it("rejects changed bytes against the original root", () => {
    const evidence = makeEvidence();
    const changed = structuredClone(evidence.bundle) as EvidenceBundle;
    changed.run.counterexample!.maximumLossBaseUnits = "1";
    const bytes = new TextEncoder().encode(canonicalJson(changed));
    expect(replayEvidenceBundle(bytes, evidence.bundleRoot)).toMatchObject({ verified: false, code: "ROOT_MISMATCH" });
  });

  it("rejects a self-consistent root whose internal graph context was changed", () => {
    const evidence = makeEvidence();
    const changed = structuredClone(evidence.bundle) as EvidenceBundle;
    changed.graph.actionIds = changed.graph.actionIds.slice(1);
    const bytes = new TextEncoder().encode(canonicalJson(changed));
    expect(replayEvidenceBundle(bytes, canonicalHash(changed))).toMatchObject({ verified: false, code: "CONTEXT_MISMATCH" });
  });

  it("rejects non-canonical JSON even when it parses", () => {
    const evidence = makeEvidence();
    const bytes = new TextEncoder().encode(JSON.stringify(evidence.bundle, null, 2));
    expect(replayEvidenceBundle(bytes, evidence.bundleRoot)).toMatchObject({ verified: false, code: "INVALID_BUNDLE" });
  });
});
