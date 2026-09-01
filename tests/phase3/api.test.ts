import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "../../packages/api/src/index.js";
import { fixtureCatalog } from "../../fixtures/v1/catalog.js";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../examples/${name}`, import.meta.url), "utf8")) as unknown;

/** Two servers: one with outward writes refused, one with them approved. */
let base = "";
let approvedBase = "";
let server: ReturnType<typeof startServer>;
let approvedServer: ReturnType<typeof startServer>;

const ANCHOR_RECORD = { fixtureId: "prompt-injection", bundleRoot: `0x${"a".repeat(64)}`, maximumLossBaseUnits: "27500000" };

beforeAll(() => {
  server = startServer(0, {
    anchorReader: (chainId, root) => (chainId === "16602" && root === ANCHOR_RECORD.bundleRoot ? ANCHOR_RECORD : null),
  });
  approvedServer = startServer(0, { approvalProvider: () => true });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  approvedBase = `http://127.0.0.1:${(approvedServer.address() as AddressInfo).port}`;
});

afterAll(() => { server.close(); approvedServer.close(); });

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, never> };
}

async function compileFixture(at = base, id = "prompt-injection") {
  const fixture = fixtureCatalog.find((f) => f.fixtureId === id);
  const res = await post(`${at}/v1/compilations`, { schemaVersion: "1", manifest: fixture?.manifest, policy: fixture?.policy });
  return res.json["data"] as unknown as { compilationId: string };
}

async function compileExample(at = base) {
  const res = await post(`${at}/v1/compilations`, { schemaVersion: "1", manifest: read("agent-manifest.json"), policy: read("spend-policy.json") });
  return res.json["data"] as unknown as { compilationId: string };
}

describe("v1 HTTP surface", () => {
  it("lists the fixture corpus", async () => {
    const res = await fetch(`${base}/v1/fixtures`);
    const body = (await res.json()) as { data: unknown[]; meta: Record<string, string> };
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(7);
    expect(body.meta.apiVersion).toBe("1");
    expect(body.meta.engineVersion).toBeDefined();
  });

  it("compiles a caller-supplied agent and returns its hashes", async () => {
    const res = await post(`${base}/v1/compilations`, { schemaVersion: "1", manifest: read("agent-manifest.json"), policy: read("spend-policy.json") });
    expect(res.status).toBe(201);
    const data = res.json["data"] as unknown as Record<string, string>;
    expect(data["status"]).toBe("SUPPORTED");
    expect(data["compilationId"]).toMatch(/^0x[0-9a-f]{64}$/);
    expect(data["graphHash"]).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects a body that is not a v1 compilation request", async () => {
    expect((await post(`${base}/v1/compilations`, { schemaVersion: "2" })).status).toBe(400);
    const malformed = await fetch(`${base}/v1/compilations`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as { error: { code: string } }).error.code).toBe("INVALID_REQUEST");
  });

  it("refuses a body over the size bound with 413 rather than buffering it", async () => {
    const huge = { schemaVersion: "1", manifest: { pad: "x".repeat(1_100_000) }, policy: {} };
    const res = await post(`${base}/v1/compilations`, huge);
    expect(res.status).toBe(413);
    expect((res.json["error"] as unknown as { code: string }).code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rejects exploration limits outside their permitted range", async () => {
    // A silently clamped or ignored limit changes what the bound means, so an
    // out-of-range limit gets its own error rather than a generic rejection.
    const res = await post(`${base}/v1/compilations`, {
      schemaVersion: "1", manifest: read("agent-manifest.json"), policy: read("spend-policy.json"),
      limits: { maxStates: 0 },
    });
    expect(res.status).toBe(400);
    expect((res.json["error"] as unknown as { code: string }).code).toBe("LIMIT_OUT_OF_RANGE");

    const ok = await post(`${base}/v1/compilations`, {
      schemaVersion: "1", manifest: read("agent-manifest.json"), policy: read("spend-policy.json"),
      limits: { maxStates: 500 },
    });
    expect(ok.status).toBe(201);
  });

  it("runs a fixture against that fixture's own compilation", async () => {
    const fixture = fixtureCatalog.find((f) => f.fixtureId === "prompt-injection");
    const compiled = await post(`${base}/v1/compilations`, { schemaVersion: "1", manifest: fixture?.manifest, policy: fixture?.policy });
    const compilationId = (compiled.json["data"] as unknown as { compilationId: string }).compilationId;

    const res = await post(`${base}/v1/runs`, { compilationId, fixtureIds: ["prompt-injection"], engineVersion: "0.1.0-contract", limits: {} });
    expect(res.status).toBe(202);
    const data = res.json["data"] as unknown as { runId: string; results: { maximumLossBaseUnits: string }[] };
    expect(data.runId).toMatch(/^run-/);
    expect(data.results[0]?.maximumLossBaseUnits).toBe("27500000");

    expect((await fetch(`${base}/v1/runs/${data.runId}`)).status).toBe(200);
  });

  it("refuses a fixture whose model is not the compilation supplied", async () => {
    // Running one fixture's declared adversarial recipients against an unrelated
    // model returns zero, which reads as a pass while answering a different
    // question. That mismatch must be an error, not a quiet zero.
    const { compilationId } = await compileExample();
    const res = await post(`${base}/v1/runs`, { compilationId, fixtureIds: ["prompt-injection"] });
    expect(res.status).toBe(409);
    expect((res.json["error"] as unknown as { code: string }).code).toBe("INVALID_STATE_TRANSITION");
  });

  it("checks a caller's own model when they declare what counts as loss", async () => {
    const { compilationId } = await compileExample();
    const res = await post(`${base}/v1/runs`, { compilationId, adversarialRecipients: ["unknown-vendor"] });
    expect(res.status).toBe(202);
    const data = res.json["data"] as unknown as { results: { maximumLossBaseUnits: string; shortestPathTransitionIds: string[] }[] };
    expect(data.results[0]?.maximumLossBaseUnits).toBe("45000000");
    expect(data.results[0]?.shortestPathTransitionIds).toEqual(["pay-unknown-vendor"]);
  });

  it("rejects an unknown compilation or fixture with 422", async () => {
    expect((await post(`${base}/v1/runs`, { compilationId: "0xdead", fixtureIds: ["prompt-injection"] })).status).toBe(422);
    const { compilationId } = await compileExample();
    expect((await post(`${base}/v1/runs`, { compilationId, fixtureIds: ["not-a-fixture"] })).status).toBe(422);
    expect((await post(`${base}/v1/runs`, { compilationId })).status).toBe(422);
  });

  it("returns 404 for a run that does not exist", async () => {
    const res = await fetch(`${base}/v1/runs/run-00000000-0000-0000-0000-000000000000`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("creates the bundle locally but refuses to publish it without approval", async () => {
    const { compilationId } = await compileFixture();
    const run = await post(`${base}/v1/runs`, { compilationId, fixtureIds: ["prompt-injection"] });
    const runId = (run.json["data"] as unknown as { runId: string }).runId;

    const res = await post(`${base}/v1/runs/${runId}/evidence`, { storageNetwork: "turbo-testnet", expectedRunRevision: 1 });
    expect(res.status).toBe(403);
    const error = res.json["error"] as unknown as { code: string; message: string };
    expect(error.code).toBe("EXTERNAL_WRITE_NOT_APPROVED");

    // The bundle itself was still produced, and is now readable.
    const root = /0x[0-9a-f]{64}/.exec(error.message)?.[0] as string;
    expect(root).toMatch(/^0x[0-9a-f]{64}$/);
    const bundle = await fetch(`${base}/v1/evidence/${root}`);
    expect(bundle.status).toBe(200);
  });

  it("accepts the publish once an approval is supplied", async () => {
    const { compilationId } = await compileFixture(approvedBase);
    const run = await post(`${approvedBase}/v1/runs`, { compilationId, fixtureIds: ["prompt-injection"] });
    const runId = (run.json["data"] as unknown as { runId: string }).runId;
    const res = await post(`${approvedBase}/v1/runs/${runId}/evidence`, { storageNetwork: "turbo-testnet", expectedRunRevision: 1 });
    expect(res.status).toBe(202);
  });

  it("refuses anchoring without approval and rejects a mismatched bundle hash", async () => {
    const root = `0x${"b".repeat(64)}`;
    const unapproved = await post(`${base}/v1/evidence/${root}/anchors`, { chainId: "16602", registryAddress: `0x${"1".repeat(40)}`, expectedBundleHash: root });
    expect(unapproved.status).toBe(403);

    const mismatched = await post(`${approvedBase}/v1/evidence/${root}/anchors`, { chainId: "16602", registryAddress: `0x${"1".repeat(40)}`, expectedBundleHash: `0x${"c".repeat(64)}` });
    expect(mismatched.status).toBe(409);
    expect((mismatched.json["error"] as unknown as { code: string }).code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("serves a recorded anchor and 404s an unrecorded one", async () => {
    const found = await fetch(`${base}/v1/evidence/${ANCHOR_RECORD.bundleRoot}/anchors/16602`);
    expect(found.status).toBe(200);
    expect(((await found.json()) as { data: { maximumLossBaseUnits: string } }).data.maximumLossBaseUnits).toBe("27500000");

    expect((await fetch(`${base}/v1/evidence/0x${"9".repeat(64)}/anchors/16602`)).status).toBe(404);
  });

  it("404s an unknown route and carries a request id on every response", async () => {
    const res = await fetch(`${base}/v1/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});
