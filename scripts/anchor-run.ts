/**
 * Produce a 0G Chain anchor request from a real Worstcase run.
 *
 * This runs the actual compiler, checker and canonical evidence pipeline — the
 * anchored values are derived from the engine, never hand-written. It performs
 * no network or signing work: the resulting request is broadcast separately by
 * contracts/anchor-0g.sh so the deployer key never enters this process.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ENGINE_VERSION, canonicalHash } from "../packages/contracts/src/index.js";
import { compileModel } from "../packages/compiler/src/index.js";
import { checkFixture } from "../packages/checker/src/index.js";
import { createLocalEvidenceBundle } from "../packages/evidence/src/index.js";
import { fixtureCatalog } from "../fixtures/v1/catalog.js";

const fixtureId = process.argv[2] ?? "prompt-injection";
const fixture = fixtureCatalog.find((candidate) => candidate.fixtureId === fixtureId);
if (fixture === undefined) {
  console.error(`Unknown fixture '${fixtureId}'. Available: ${fixtureCatalog.map((f) => f.fixtureId).join(", ")}`);
  process.exit(1);
}

const compiled = compileModel(fixture.manifest, fixture.policy);
if (compiled.status !== "SUPPORTED") {
  console.error(`Fixture '${fixtureId}' did not compile to a supported model; refusing to anchor.`);
  process.exit(1);
}

const result = checkFixture(compiled, fixture);
const evidence = createLocalEvidenceBundle(compiled, fixture, result);
const run = evidence.bundle.run;

// The registry encodes UNKNOWN as status 2 and forbids it carrying a loss claim.
const status = run.stage === "COMPLETE" ? 1 : 2;
const maximumLossBaseUnits = run.stage === "COMPLETE" ? run.counterexample.maximumLossBaseUnits : "0";

const request = {
  fixtureId,
  engineVersion: ENGINE_VERSION,
  runId: run.runId,
  bundleRoot: evidence.bundleRoot,
  policyHash: run.policyHash,
  graphHash: run.graphHash,
  maximumLossBaseUnits,
  engineVersionHash: canonicalHash(ENGINE_VERSION),
  status,
  statusLabel: run.stage,
  shortestPathTransitionIds: run.stage === "COMPLETE" ? run.counterexample.transitionIds : [],
};

mkdirSync("contracts/deployments", { recursive: true });
mkdirSync("evidence", { recursive: true });
writeFileSync("contracts/deployments/anchor-request.json", `${JSON.stringify(request, null, 2)}\n`, "utf8");
writeFileSync(`evidence/${evidence.bundleRoot}.json`, Buffer.from(evidence.bytes), "utf8");

console.log(`Fixture:        ${fixtureId}`);
console.log(`Result:         ${run.stage}`);
console.log(`Maximum loss:   ${maximumLossBaseUnits} base units`);
console.log(`Bundle root:    ${evidence.bundleRoot}`);
console.log(`Evidence bytes: evidence/${evidence.bundleRoot}.json`);
console.log(`Anchor request: contracts/deployments/anchor-request.json`);
