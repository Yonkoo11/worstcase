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
