import {
  ENGINE_VERSION,
  EvidenceBundleSchema,
  canonicalHash,
  canonicalJson,
  type EvidenceBundle,
  type Fixture,
  type Run,
} from "../../contracts/src/index.js";
import { checkFixture, type CheckResult } from "../../checker/src/index.js";
import { compileModel, type CompiledModel } from "../../compiler/src/index.js";

export type CanonicalEvidence = {
  bundle: EvidenceBundle;
  bytes: Uint8Array;
  bundleRoot: `0x${string}`;
};

export type ReplayResult =
  | { verified: true; bundleRoot: `0x${string}`; run: Run }
  | { verified: false; code: "INVALID_BUNDLE" | "ROOT_MISMATCH" | "CONTEXT_MISMATCH" | "REPLAY_MISMATCH"; message: string };

function runFromResult(compiled: CompiledModel, fixture: Fixture, result: CheckResult): Run {
  const base = {
    schemaVersion: fixture.schemaVersion,
    engineVersion: compiled.engineVersion,
    runId: `run-${canonicalHash({ fixtureId: fixture.fixtureId, graphHash: compiled.graphHash }).slice(2, 26)}`,
    manifestHash: compiled.manifestHash,
    policyHash: compiled.policyHash,
    graphHash: compiled.graphHash,
    fixtureIds: [fixture.fixtureId] as string[],
    limits: compiled.limits,
  };

  if (result.status === "UNKNOWN") {
    return { ...base, stage: "UNKNOWN", unknownReason: result.unknownReason };
  }
  return {
    ...base,
    stage: "COMPLETE",
    counterexample: {
      maximumLossBaseUnits: result.maximumLossBaseUnits,
      transitionIds: result.shortestPathTransitionIds,
      blocked: result.blocked,
    },
  };
}

export function createLocalEvidenceBundle(compiled: CompiledModel, fixture: Fixture, result: CheckResult): CanonicalEvidence {
  const bundle = EvidenceBundleSchema.parse({
    schemaVersion: fixture.schemaVersion,
    engineVersion: ENGINE_VERSION,
    origin: "LOCAL_FIXTURE",
    run: runFromResult(compiled, fixture, result),
    manifest: compiled.manifest,
    policy: compiled.policy,
    graph: compiled.graph,
    fixtures: [fixture],
    // The trajectory the search actually accepted as the counterexample.
    //
    // This used to be the hashes of the fixture's declared `candidateTrajectories`.
    // Once the checker searches the state space those declarations no longer drive
    // the result, so recording them here asserted a provenance the run did not
    // have. An UNKNOWN run accepted nothing and records nothing.
    acceptedCandidateHashes: result.status === "COMPLETE" ? [canonicalHash(result.shortestPathTransitionIds)] : [],
    rejectedCandidates: [],
  });
  const json = canonicalJson(bundle);
  return { bundle, bytes: new TextEncoder().encode(json), bundleRoot: canonicalHash(bundle) };
}

export function replayEvidenceBundle(bytes: Uint8Array, expectedRoot: `0x${string}`): ReplayResult {
  let bundle: EvidenceBundle;
  try {
    bundle = EvidenceBundleSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch {
    return { verified: false, code: "INVALID_BUNDLE", message: "Evidence bytes are not a valid v1 canonical bundle." };
  }

  const actualRoot = canonicalHash(bundle);
  if (actualRoot !== expectedRoot) return { verified: false, code: "ROOT_MISMATCH", message: "Evidence root does not match the requested root." };
  if (new TextEncoder().encode(canonicalJson(bundle)).length !== bytes.length || canonicalJson(bundle) !== new TextDecoder().decode(bytes)) {
    return { verified: false, code: "INVALID_BUNDLE", message: "Evidence bytes are valid JSON but not canonical JSON." };
  }
  if (
    canonicalHash(bundle.manifest) !== bundle.run.manifestHash ||
    canonicalHash(bundle.policy) !== bundle.run.policyHash ||
    canonicalHash(bundle.graph) !== bundle.run.graphHash ||
    bundle.graph.manifestHash !== bundle.run.manifestHash ||
    bundle.graph.policyHash !== bundle.run.policyHash ||
    bundle.engineVersion !== bundle.run.engineVersion ||
    bundle.fixtures.length !== 1 ||
    bundle.fixtures[0]?.fixtureId !== bundle.run.fixtureIds[0]
  ) {
    return { verified: false, code: "CONTEXT_MISMATCH", message: "Bundle components are not bound to the recorded run context." };
  }

  const fixture = bundle.fixtures[0];
  const compiled = compileModel(bundle.manifest, bundle.policy, bundle.graph.limits);
  if (fixture === undefined || compiled.status !== "SUPPORTED" || compiled.graphHash !== bundle.run.graphHash) {
    return { verified: false, code: "CONTEXT_MISMATCH", message: "Recorded model does not reproduce the run graph." };
  }
  const replayed = checkFixture(compiled, fixture);
  const replayRun = runFromResult(compiled, fixture, replayed);
  const expectedProjection = bundle.run.stage === "COMPLETE" ? bundle.run.counterexample : bundle.run.unknownReason;
  const actualProjection = replayRun.stage === "COMPLETE" ? replayRun.counterexample : replayRun.stage === "UNKNOWN" ? replayRun.unknownReason : undefined;
  if (bundle.run.stage !== replayRun.stage || canonicalJson(expectedProjection) !== canonicalJson(actualProjection)) {
    return { verified: false, code: "REPLAY_MISMATCH", message: "Deterministic replay does not match the recorded analytical result." };
  }

  // The accepted trajectory is re-derived rather than trusted, so the bundle
  // cannot claim a counterexample the replayed search did not actually accept.
  const expectedAccepted = replayRun.stage === "COMPLETE" && replayRun.counterexample !== undefined
    ? [canonicalHash(replayRun.counterexample.transitionIds)]
    : [];
  if (canonicalJson(bundle.acceptedCandidateHashes) !== canonicalJson(expectedAccepted)) {
    return { verified: false, code: "REPLAY_MISMATCH", message: "Recorded accepted trajectory does not match the replayed counterexample." };
  }
  return { verified: true, bundleRoot: actualRoot, run: bundle.run };
}
