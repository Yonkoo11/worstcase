import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { startServer } from "../../packages/api/src/index.js";
import { FileStore, MemoryStore } from "../../packages/api/src/store.js";
import { ApiKeyAuth, RateLimiter, callerKey } from "../../packages/api/src/guards.js";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../examples/${name}`, import.meta.url), "utf8")) as unknown;

function serve(options: Parameters<typeof startServer>[1]) {
  const server = startServer(0, options);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base };
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, never>, headers: res.headers };
}

describe("authentication", () => {
  it("refuses a request with no or wrong bearer token, and accepts a valid one", async () => {
    const { server, base } = serve({ store: new MemoryStore(), apiKeys: ["secret-key-one", "secret-key-two"] });
    try {
      expect((await fetch(`${base}/v1/fixtures`)).status).toBe(401);
      expect((await fetch(`${base}/v1/fixtures`, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
      expect((await fetch(`${base}/v1/fixtures`, { headers: { authorization: "secret-key-one" } })).status).toBe(401);
      expect((await fetch(`${base}/v1/fixtures`, { headers: { authorization: "Bearer secret-key-two" } })).status).toBe(200);
    } finally { server.close(); }
  });

  it("treats an empty key list as a deliberately open deployment", () => {
    expect(new ApiKeyAuth([]).isOpen).toBe(true);
    expect(new ApiKeyAuth(["k"]).isOpen).toBe(false);
    // Blank entries must not silently open a deployment that meant to be closed.
    expect(new ApiKeyAuth(["", "  "]).isOpen).toBe(true);
    expect(new ApiKeyAuth(["", "real"]).accepts("Bearer real")).toBe(true);
    expect(new ApiKeyAuth(["", "real"]).accepts(undefined)).toBe(false);
  });
});

describe("rate limiting", () => {
  it("returns 429 with a retry-after once the window is spent", async () => {
    const { server, base } = serve({ store: new MemoryStore(), rateLimit: { limit: 3, windowMs: 60_000 } });
    try {
      for (let i = 0; i < 3; i += 1) expect((await fetch(`${base}/v1/fixtures`)).status).toBe(200);
      const limited = await fetch(`${base}/v1/fixtures`);
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(((await limited.json()) as { error: { code: string; retryable: boolean } }).error.code).toBe("RATE_LIMITED");
    } finally { server.close(); }
  });

  it("opens a fresh window after the old one elapses", () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("a", 10).allowed).toBe(true);
    expect(limiter.check("a", 20).allowed).toBe(false);
    expect(limiter.check("a", 1100).allowed).toBe(true);
  });

  it("counts callers separately", () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("b", 0).allowed).toBe(true);
    expect(limiter.check("a", 1).allowed).toBe(false);
  });

  it("ignores x-forwarded-for unless the deployment says it is behind a proxy", () => {
    // Trusting the header unconditionally lets a caller mint a new identity per
    // request and turn the limiter off entirely.
    expect(callerKey("1.1.1.1", "9.9.9.9", false)).toBe("1.1.1.1");
    expect(callerKey("1.1.1.1", "9.9.9.9", true)).toBe("9.9.9.9");
    expect(callerKey("1.1.1.1", "9.9.9.9, 8.8.8.8", true)).toBe("9.9.9.9");
    expect(callerKey("1.1.1.1", undefined, true)).toBe("1.1.1.1");
  });

  it("does not let a spoofed forwarded header escape the limiter by default", async () => {
    const { server, base } = serve({ store: new MemoryStore(), rateLimit: { limit: 2, windowMs: 60_000 } });
    try {
      await fetch(`${base}/v1/fixtures`, { headers: { "x-forwarded-for": "10.0.0.1" } });
      await fetch(`${base}/v1/fixtures`, { headers: { "x-forwarded-for": "10.0.0.2" } });
      const third = await fetch(`${base}/v1/fixtures`, { headers: { "x-forwarded-for": "10.0.0.3" } });
      expect(third.status).toBe(429);
    } finally { server.close(); }
  });
});

describe("per-request search budget", () => {
  it("refuses a budget above the server ceiling instead of clamping it quietly", async () => {
    // One unbounded request was measured at ~36s CPU and ~680MB RSS, which a
    // rate limit alone does not contain. Silently reducing the budget would
    // change what the returned bound covers without telling the caller.
    const { server, base } = serve({ store: new MemoryStore(), ceilings: { maxStates: 5_000, timeoutMs: 2_000, maxDepth: 16 } });
    try {
      const over = await post(`${base}/v1/compilations`, {
        schemaVersion: "1", manifest: read("agent-manifest.json"), policy: read("spend-policy.json"),
        limits: { maxStates: 1_000_000 },
      });
      expect(over.status).toBe(400);
      const error = over.json["error"] as unknown as { code: string; message: string };
      expect(error.code).toBe("LIMIT_OUT_OF_RANGE");
      expect(error.message).toContain("ceiling");

      const within = await post(`${base}/v1/compilations`, {
        schemaVersion: "1", manifest: read("agent-manifest.json"), policy: read("spend-policy.json"),
        limits: { maxStates: 4_000 },
      });
      expect(within.status).toBe(201);
      expect((within.json["data"] as unknown as { limits: { maxStates: number } }).limits.maxStates).toBe(4_000);
    } finally { server.close(); }
  });

  it("keeps a hostile search inside the ceiling rather than burning the host", async () => {
    const { server, base } = serve({ store: new MemoryStore(), ceilings: { maxStates: 2_000, timeoutMs: 2_000, maxDepth: 16 } });
    try {
      const actions = Array.from({ length: 20 }, (_, i) => ({
        id: `pay-${String(i).padStart(2, "0")}`, type: "transfer", assetId: "usdc",
        amountBaseUnits: String(1000 * (i + 1)), recipient: "sink",
      }));
      const manifest = { schemaVersion: "1", manifestId: "hostile", tools: [{ id: "pay", actionIds: actions.map((a) => a.id) }], actions, unsupported: [] };
      const policy = {
        schemaVersion: "1", policyId: "hostile", assets: [{ id: "usdc", symbol: "USDC", decimals: 6 }],
        protectedBalances: { usdc: "100000000000" }, allowedRecipients: { usdc: ["sink"] },
        perActionCaps: { usdc: "100000000000" }, cumulativeCaps: { usdc: "100000000000" },
        requireUniqueNonce: false, maxConcurrency: 1, maxRecursionDepth: 0,
      };
      const compiled = await post(`${base}/v1/compilations`, { schemaVersion: "1", manifest, policy });
      const compilationId = (compiled.json["data"] as unknown as { compilationId: string }).compilationId;

      const started = Date.now();
      const run = await post(`${base}/v1/runs`, { compilationId, adversarialRecipients: ["sink"] });
      const elapsed = Date.now() - started;

      expect(run.status).toBe(202);
      const result = (run.json["data"] as unknown as { results: { status: string; unknownReason?: string }[] }).results[0];
      // Truncated, and truncation is reported rather than passed off as a bound.
      expect(result?.status).toBe("UNKNOWN");
      expect(result?.unknownReason).toBe("MAX_STATES");
      expect(elapsed).toBeLessThan(5_000);
    } finally { server.close(); }
  });
});

describe("durability", () => {
  it("serves a run created before a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "worstcase-store-"));
    const first = serve({ store: new FileStore(dir) });
    let runId = "";
    try {
      const compiled = await post(`${first.base}/v1/compilations`, { schemaVersion: "1", manifest: read("agent-manifest.json"), policy: read("spend-policy.json") });
      const compilationId = (compiled.json["data"] as unknown as { compilationId: string }).compilationId;
      const run = await post(`${first.base}/v1/runs`, { compilationId, adversarialRecipients: ["unknown-vendor"] });
      runId = (run.json["data"] as unknown as { runId: string }).runId;
      expect(run.status).toBe(202);
    } finally { first.server.close(); }

    // A brand new process-equivalent, sharing only the directory on disk.
    const second = serve({ store: new FileStore(dir) });
    try {
      const res = await fetch(`${second.base}/v1/runs/${runId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { results: { maximumLossBaseUnits: string }[] } };
      expect(body.data.results[0]?.maximumLossBaseUnits).toBe("45000000");
    } finally { second.server.close(); }
  });

  it("never exposes a partially written record", () => {
    const dir = mkdtempSync(join(tmpdir(), "worstcase-atomic-"));
    const store = new FileStore(dir);
    store.put("runs", "r1", { value: "first" });
    // A crashed writer leaves a temp file behind; it must not be served as the record.
    writeFileSync(join(dir, "runs", "r1.json.999.tmp"), '{"value":"half', "utf8");
    expect(store.get("runs", "r1")).toEqual({ value: "first" });
    expect(store.count("runs")).toBe(1);
  });

  it("refuses record ids that would escape the store directory", () => {
    const store = new FileStore(mkdtempSync(join(tmpdir(), "worstcase-safe-")));
    expect(() => store.put("runs", "../../etc/passwd", {})).toThrow("UNSAFE_RECORD_ID");
    expect(() => store.put("../../etc", "x", {})).toThrow("UNSAFE_RECORD_ID");
    expect(store.get("runs", "../../etc/passwd")).toBeNull();
  });
});
