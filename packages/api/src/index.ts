/**
 * The v1 HTTP surface described by docs/openapi.yaml.
 *
 * Built on node:http with no additional dependencies, so exposing an API does
 * not cost the workspace its zero-advisory dependency graph.
 *
 * Read paths are fully served. The two write paths that reach outside the
 * process, uploading evidence to 0G Storage and anchoring on 0G Chain, are
 * refused with EXTERNAL_WRITE_NOT_APPROVED unless an approval provider is
 * supplied. That mirrors the boundary the rest of the system enforces: an
 * outward action needs a scoped approval, and an API is not an exemption.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { ENGINE_VERSION, FixtureSchema, SCHEMA_VERSION, type EvidenceBundle } from "../../contracts/src/index.js";
import { compileModel, DEFAULT_LIMITS, type CompiledModel } from "../../compiler/src/index.js";
import { checkFixture, searchMaximumLoss } from "../../checker/src/index.js";
import { createLocalEvidenceBundle } from "../../evidence/src/index.js";
import { fixtureCatalog } from "../../../fixtures/v1/catalog.js";

export type ErrorCode =
  | "INVALID_REQUEST" | "LIMIT_OUT_OF_RANGE" | "UNAUTHORIZED" | "EXTERNAL_WRITE_NOT_APPROVED"
  | "NOT_FOUND" | "IDEMPOTENCY_CONFLICT" | "INVALID_STATE_TRANSITION" | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED" | "DEPENDENCY_UNAVAILABLE" | "INTERNAL";

const MAX_BODY_BYTES = 1_048_576;

/** Deployment record lookup, injectable so tests do not depend on the filesystem. */
export type AnchorReader = (chainId: string, bundleRoot: string) => Record<string, unknown> | null;

const defaultAnchorReader: AnchorReader = (chainId, bundleRoot) => {
  for (const fixture of fixtureCatalog) {
    try {
      const record = JSON.parse(readFileSync(`contracts/deployments/${chainId}-anchor-${fixture.fixtureId}.json`, "utf8")) as Record<string, unknown>;
      if (record["bundleRoot"] === bundleRoot) return record;
    } catch { /* no record for this fixture on this chain */ }
  }
  return null;
};

export type ApiOptions = {
  /** Supplying this is what permits outward writes. Absent means every write is refused. */
  approvalProvider?: undefined | (() => boolean);
  anchorReader?: AnchorReader;
};

type StoredRun = {
  runId: string;
  compilationId: string;
  fixtureIds: string[];
  results: Record<string, unknown>[];
  createdAt: string;
};

export function createApi(options: ApiOptions = {}) {
  const compilations = new Map<string, { compiled: CompiledModel; manifest: unknown; policy: unknown }>();
  const runs = new Map<string, StoredRun>();
  const evidence = new Map<string, { bundle: EvidenceBundle; bytes: Uint8Array }>();
  const anchorReader = options.anchorReader ?? defaultAnchorReader;
  const writesApproved = options.approvalProvider ?? (() => false);

  const meta = (requestId: string) => ({ requestId, apiVersion: "1", schemaVersion: SCHEMA_VERSION, engineVersion: ENGINE_VERSION });

  function ok(res: ServerResponse, status: number, requestId: string, data: unknown): void {
    const body = JSON.stringify({ data, meta: meta(requestId) });
    res.writeHead(status, { "content-type": "application/json", "x-request-id": requestId });
    res.end(body);
  }

  function fail(res: ServerResponse, status: number, requestId: string, code: ErrorCode, message: string, retryable = false): void {
    const body = JSON.stringify({ error: { code, message, retryable, requestId } });
    res.writeHead(status, { "content-type": "application/json", "x-request-id": requestId });
    res.end(body);
  }

  async function readBody(req: IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false; code: ErrorCode; message: string }> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      total += (chunk as Buffer).length;
      // Bound the body before buffering it, not after.
      if (total > MAX_BODY_BYTES) return { ok: false, code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds 1 MiB." };
      chunks.push(chunk as Buffer);
    }
    if (total === 0) return { ok: false, code: "INVALID_REQUEST", message: "A JSON body is required." };
    try {
      return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    } catch {
      return { ok: false, code: "INVALID_REQUEST", message: "Body is not valid JSON." };
    }
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const requestId = randomUUID();
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method ?? "GET";

    try {
      if (method === "GET" && path === "/v1/fixtures") {
        return ok(res, 200, requestId, fixtureCatalog.map((f) => ({
          fixtureId: f.fixtureId, family: f.family, description: f.description,
          manifestId: f.manifest.manifestId, adversarialRecipients: f.adversarialRecipients,
        })));
      }

      if (method === "POST" && path === "/v1/compilations") {
        const body = await readBody(req);
        if (!body.ok) return fail(res, body.code === "PAYLOAD_TOO_LARGE" ? 413 : 400, requestId, body.code, body.message);
        const input = body.value as Record<string, unknown>;
        if (input?.["schemaVersion"] !== SCHEMA_VERSION || input["manifest"] === undefined || input["policy"] === undefined) {
          return fail(res, 400, requestId, "INVALID_REQUEST", "schemaVersion, manifest and policy are required.");
        }
        let compiled: CompiledModel | ReturnType<typeof compileModel>;
        try {
          compiled = compileModel(input["manifest"], input["policy"], input["limits"] ?? DEFAULT_LIMITS);
        } catch (error) {
          return fail(res, 400, requestId, "INVALID_REQUEST", `Model rejected: ${(error as Error).message}`);
        }
        if (compiled.status !== "SUPPORTED") {
          // An unsupported model is a valid answer, not a server error, but it
          // must never be returned as if a bound had been computed.
          return ok(res, 201, requestId, { status: compiled.status, issues: compiled.issues });
        }
        compilations.set(compiled.compilationId, { compiled, manifest: input["manifest"], policy: input["policy"] });
        return ok(res, 201, requestId, {
          compilationId: compiled.compilationId, status: compiled.status,
          manifestHash: compiled.manifestHash, policyHash: compiled.policyHash, graphHash: compiled.graphHash,
          limits: compiled.limits,
        });
      }

      if (method === "POST" && path === "/v1/runs") {
        const body = await readBody(req);
        if (!body.ok) return fail(res, body.code === "PAYLOAD_TOO_LARGE" ? 413 : 400, requestId, body.code, body.message);
        const input = body.value as Record<string, unknown>;
        const compilationId = input?.["compilationId"];
        const fixtureIds = input?.["fixtureIds"];
        const adversarialRecipients = input?.["adversarialRecipients"];
        const hasFixtures = Array.isArray(fixtureIds) && fixtureIds.length > 0 && fixtureIds.length <= 7;
        const hasRecipients = Array.isArray(adversarialRecipients) && adversarialRecipients.length > 0 && adversarialRecipients.every((r) => typeof r === "string");

        if (typeof compilationId !== "string" || (!hasFixtures && !hasRecipients)) {
          return fail(res, 422, requestId, "INVALID_REQUEST", "compilationId plus either 1 to 7 fixtureIds, or adversarialRecipients to check your own model.");
        }
        const entry = compilations.get(compilationId);
        if (entry === undefined) return fail(res, 422, requestId, "INVALID_REQUEST", "Unknown compilationId. Create a compilation first.");

        // Checking the caller's own model: they say what counts as loss.
        if (!hasFixtures) {
          const result = searchMaximumLoss(entry.compiled, adversarialRecipients as string[]);
          const runId = `run-${randomUUID()}`;
          runs.set(runId, { runId, compilationId, fixtureIds: [], results: [{ ...result }], createdAt: new Date().toISOString() });
          return ok(res, 202, requestId, { runId, compilationId, adversarialRecipients, results: [result] });
        }

        // A fixture names both a model and the recipients that count as loss.
        // Running one fixture's recipients against an unrelated caller model
        // silently returns zero, which reads as "safe" while meaning "you asked
        // a question about a different agent". Refuse the mismatch instead.
        const results: Record<string, unknown>[] = [];
        for (const id of fixtureIds) {
          const fixture = fixtureCatalog.find((f) => f.fixtureId === id);
          if (fixture === undefined) return fail(res, 422, requestId, "INVALID_REQUEST", `Unknown fixtureId '${String(id)}'.`);

          const fixtureCompiled = compileModel(fixture.manifest, fixture.policy, entry.compiled.limits);
          if (fixtureCompiled.status !== "SUPPORTED") return fail(res, 409, requestId, "INVALID_STATE_TRANSITION", `Fixture '${String(id)}' no longer compiles.`);
          if (fixtureCompiled.compilationId !== compilationId) {
            return fail(res, 409, requestId, "INVALID_STATE_TRANSITION",
              `compilationId does not match fixture '${String(id)}'. Compile that fixture's own manifest and policy, or omit fixtureIds and pass adversarialRecipients to check your own model.`);
          }
          results.push({ fixtureId: id, ...checkFixture(fixtureCompiled, fixture) });
        }
        const runId = `run-${randomUUID()}`;
        runs.set(runId, { runId, compilationId, fixtureIds: fixtureIds as string[], results, createdAt: new Date().toISOString() });
        return ok(res, 202, requestId, { runId, compilationId, results });
      }

      const runMatch = /^\/v1\/runs\/([A-Za-z0-9-]+)$/.exec(path);
      if (method === "GET" && runMatch !== null) {
        const run = runs.get(runMatch[1] as string);
        if (run === undefined) return fail(res, 404, requestId, "NOT_FOUND", "No such run.");
        return ok(res, 200, requestId, run);
      }

      const evidenceMatch = /^\/v1\/runs\/([A-Za-z0-9-]+)\/evidence$/.exec(path);
      if (method === "POST" && evidenceMatch !== null) {
        const run = runs.get(evidenceMatch[1] as string);
        if (run === undefined) return fail(res, 404, requestId, "NOT_FOUND", "No such run.");
        const entry = compilations.get(run.compilationId);
        if (entry === undefined) return fail(res, 409, requestId, "INVALID_STATE_TRANSITION", "The run's compilation is no longer held.");

        if (run.fixtureIds.length === 0) {
          // Own-model runs have no fixture to bind the bundle to. Say so rather
          // than silently emitting evidence for a different model.
          return fail(res, 409, requestId, "INVALID_STATE_TRANSITION",
            "Evidence bundles are currently produced for fixture-backed runs only. This run checked a caller-supplied model.");
        }
        const fixture = fixtureCatalog.find((f) => f.fixtureId === run.fixtureIds[0]);
        if (fixture === undefined) return fail(res, 409, requestId, "INVALID_STATE_TRANSITION", "The run's fixture is unavailable.");
        const parsed = FixtureSchema.parse(fixture);
        const bundle = createLocalEvidenceBundle(entry.compiled, parsed, checkFixture(entry.compiled, parsed));
        evidence.set(bundle.bundleRoot, { bundle: bundle.bundle, bytes: bundle.bytes });

        if (!writesApproved()) {
          // The canonical bundle exists locally; publishing it to 0G Storage is
          // an outward action and needs an approval this request does not carry.
          return fail(res, 403, requestId, "EXTERNAL_WRITE_NOT_APPROVED",
            `Bundle ${bundle.bundleRoot} was created locally. Uploading it to 0G Storage requires a scoped approval.`);
        }
        return ok(res, 202, requestId, { bundleRoot: bundle.bundleRoot, storage: "upload accepted" });
      }

      const bundleMatch = /^\/v1\/evidence\/(0x[0-9a-f]{64})$/.exec(path);
      if (method === "GET" && bundleMatch !== null) {
        const held = evidence.get(bundleMatch[1] as string);
        if (held === undefined) return fail(res, 404, requestId, "NOT_FOUND", "No such evidence bundle.");
        return ok(res, 200, requestId, held.bundle);
      }

      const anchorPostMatch = /^\/v1\/evidence\/(0x[0-9a-f]{64})\/anchors$/.exec(path);
      if (method === "POST" && anchorPostMatch !== null) {
        const body = await readBody(req);
        if (!body.ok) return fail(res, body.code === "PAYLOAD_TOO_LARGE" ? 413 : 400, requestId, body.code, body.message);
        const input = body.value as Record<string, unknown>;
        if (typeof input?.["chainId"] !== "string" || typeof input["registryAddress"] !== "string" || typeof input["expectedBundleHash"] !== "string") {
          return fail(res, 400, requestId, "INVALID_REQUEST", "chainId, registryAddress and expectedBundleHash are required.");
        }
        if (input["expectedBundleHash"] !== anchorPostMatch[1]) {
          return fail(res, 409, requestId, "IDEMPOTENCY_CONFLICT", "expectedBundleHash does not match the addressed bundle.");
        }
        if (!writesApproved()) {
          return fail(res, 403, requestId, "EXTERNAL_WRITE_NOT_APPROVED", "Anchoring on 0G Chain requires a scoped approval.");
        }
        return ok(res, 202, requestId, { bundleRoot: anchorPostMatch[1], chain: "anchor accepted" });
      }

      const anchorGetMatch = /^\/v1\/evidence\/(0x[0-9a-f]{64})\/anchors\/([1-9][0-9]*)$/.exec(path);
      if (method === "GET" && anchorGetMatch !== null) {
        const record = anchorReader(anchorGetMatch[2] as string, anchorGetMatch[1] as string);
        if (record === null) return fail(res, 404, requestId, "NOT_FOUND", "No anchor recorded for that bundle on that chain.");
        return ok(res, 200, requestId, record);
      }

      return fail(res, 404, requestId, "NOT_FOUND", `No route for ${method} ${path}.`);
    } catch (error) {
      return fail(res, 500, requestId, "INTERNAL", (error as Error).message, true);
    }
  };

  return { handler, compilations, runs, evidence };
}

export function startServer(port = 8787, options: ApiOptions = {}) {
  const api = createApi(options);
  const server = createServer((req, res) => { void api.handler(req, res); });
  server.listen(port);
  return server;
}
