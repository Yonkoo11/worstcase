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
import { ENGINE_VERSION, ExplorationLimitsSchema, FixtureSchema, SCHEMA_VERSION, type EvidenceBundle } from "../../contracts/src/index.js";
import { compileModel, DEFAULT_LIMITS, type CompiledModel } from "../../compiler/src/index.js";
import { checkFixture, searchMaximumLoss } from "../../checker/src/index.js";
import { createLocalEvidenceBundle } from "../../evidence/src/index.js";
import { fixtureCatalog } from "../../../fixtures/v1/catalog.js";
import { MemoryStore, type Store } from "./store.js";
import { ApiKeyAuth, RateLimiter, callerKey } from "./guards.js";

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
  /** Durable by default in the server entrypoint; tests pass a MemoryStore. */
  store?: Store;
  /** Bearer keys. An empty list leaves the deployment deliberately open. */
  apiKeys?: readonly string[];
  rateLimit?: { limit: number; windowMs: number } | undefined;
  /** Only set behind a proxy you control; otherwise x-forwarded-for is spoofable. */
  trustProxy?: boolean;
};

type StoredRun = {
  runId: string;
  compilationId: string;
  fixtureIds: string[];
  results: Record<string, unknown>[];
  createdAt: string;
};

export function createApi(options: ApiOptions = {}) {
  const store = options.store ?? new MemoryStore();
  // Compiled models hold Maps and cannot be serialised, so they are rebuilt from
  // the stored manifest and policy after a restart rather than cached across one.
  const compiled = new Map<string, CompiledModel>();
  const anchorReader = options.anchorReader ?? defaultAnchorReader;
  const writesApproved = options.approvalProvider ?? (() => false);
  const auth = new ApiKeyAuth(options.apiKeys ?? []);
  const limiter = new RateLimiter(options.rateLimit?.limit ?? 60, options.rateLimit?.windowMs ?? 60_000);
  const trustProxy = options.trustProxy === true;

  /** Rebuild a compiled model, from cache when warm and from the store when cold. */
  function loadCompilation(compilationId: string): { compiled: CompiledModel; manifest: unknown; policy: unknown } | null {
    const record = store.get("compilations", compilationId) as { manifest: unknown; policy: unknown; limits: unknown } | null;
    if (record === null) return null;
    const warm = compiled.get(compilationId);
    if (warm !== undefined) return { compiled: warm, manifest: record.manifest, policy: record.policy };
    const rebuilt = compileModel(record.manifest, record.policy, record.limits);
    if (rebuilt.status !== "SUPPORTED") return null;
    compiled.set(compilationId, rebuilt);
    return { compiled: rebuilt, manifest: record.manifest, policy: record.policy };
  }

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
      // Rate limit before authentication, so an unauthenticated flood cannot
      // spend the server's time on key comparison.
      const caller = callerKey(req.socket.remoteAddress, req.headers["x-forwarded-for"] as string | undefined, trustProxy);
      const decision = limiter.check(caller);
      if (!decision.allowed) {
        res.setHeader("retry-after", String(decision.retryAfterSeconds));
        return fail(res, 429, requestId, "RATE_LIMITED", `Too many requests. Retry in ${decision.retryAfterSeconds}s.`, true);
      }

      if (!auth.accepts(req.headers.authorization)) {
        return fail(res, 401, requestId, "UNAUTHORIZED", "A valid bearer token is required.");
      }

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
        // Exploration limits decide how much of the state space is searched, so
        // a bad one silently changes what the bound means. Reject it as its own
        // error rather than folding it into a generic invalid-request.
        let limits = DEFAULT_LIMITS;
        if (input["limits"] !== undefined && Object.keys(input["limits"] as object).length > 0) {
          const parsed = ExplorationLimitsSchema.safeParse({ ...DEFAULT_LIMITS, ...(input["limits"] as object) });
          if (!parsed.success) {
            return fail(res, 400, requestId, "LIMIT_OUT_OF_RANGE", `Exploration limits are out of range: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
          }
          limits = parsed.data;
        }

        let compiled: CompiledModel | ReturnType<typeof compileModel>;
        try {
          compiled = compileModel(input["manifest"], input["policy"], limits);
        } catch (error) {
          return fail(res, 400, requestId, "INVALID_REQUEST", `Model rejected: ${(error as Error).message}`);
        }
        if (compiled.status !== "SUPPORTED") {
          // An unsupported model is a valid answer, not a server error, but it
          // must never be returned as if a bound had been computed.
          return ok(res, 201, requestId, { status: compiled.status, issues: compiled.issues });
        }
        store.put("compilations", compiled.compilationId, { manifest: input["manifest"], policy: input["policy"], limits });
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
        const entry = loadCompilation(compilationId);
        if (entry === null) return fail(res, 422, requestId, "INVALID_REQUEST", "Unknown compilationId. Create a compilation first.");

        // Checking the caller's own model: they say what counts as loss.
        if (!hasFixtures) {
          const result = searchMaximumLoss(entry.compiled, adversarialRecipients as string[]);
          const runId = `run-${randomUUID()}`;
          store.put("runs", runId, { runId, compilationId, fixtureIds: [], results: [{ ...result }], createdAt: new Date().toISOString() });
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
        store.put("runs", runId, { runId, compilationId, fixtureIds: fixtureIds as string[], results, createdAt: new Date().toISOString() });
        return ok(res, 202, requestId, { runId, compilationId, results });
      }

      const runMatch = /^\/v1\/runs\/([A-Za-z0-9-]+)$/.exec(path);
      if (method === "GET" && runMatch !== null) {
        const run = store.get("runs", runMatch[1] as string) as StoredRun | null;
        if (run === null) return fail(res, 404, requestId, "NOT_FOUND", "No such run.");
        return ok(res, 200, requestId, run);
      }

      const evidenceMatch = /^\/v1\/runs\/([A-Za-z0-9-]+)\/evidence$/.exec(path);
      if (method === "POST" && evidenceMatch !== null) {
        const run = store.get("runs", evidenceMatch[1] as string) as StoredRun | null;
        if (run === null) return fail(res, 404, requestId, "NOT_FOUND", "No such run.");
        const entry = loadCompilation(run.compilationId);
        if (entry === null) return fail(res, 409, requestId, "INVALID_STATE_TRANSITION", "The run's compilation is no longer held.");

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
        store.put("evidence", bundle.bundleRoot, bundle.bundle);

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
        const held = store.get("evidence", bundleMatch[1] as string);
        if (held === null) return fail(res, 404, requestId, "NOT_FOUND", "No such evidence bundle.");
        return ok(res, 200, requestId, held);
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

  return { handler, store, auth };
}

export function startServer(port = 8787, options: ApiOptions = {}) {
  const api = createApi(options);
  const server = createServer((req, res) => { void api.handler(req, res); });
  server.listen(port);
  return server;
}
