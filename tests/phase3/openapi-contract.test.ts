import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "../../packages/api/src/index.js";

/**
 * The published spec is a promise. This checks the server keeps it.
 *
 * Not a schema validation: it asserts that every path and method `docs/openapi.yaml`
 * advertises is actually routed, and that the spec does not advertise a port nobody
 * listens on. Both are drift a passing unit suite never notices, because the unit
 * tests exercise the routes they already know about and never read the spec.
 */
const spec = readFileSync(new URL("../../docs/openapi.yaml", import.meta.url), "utf8");

/** Minimal reader for the shape this spec uses: two-space paths, four-space methods. */
function documentedOperations(): { method: string; path: string }[] {
  const operations: { method: string; path: string }[] = [];
  let current: string | null = null;
  for (const line of spec.split("\n")) {
    const path = /^ {2}(\/\S+):\s*$/.exec(line);
    if (path !== null) {
      current = path[1] as string;
      continue;
    }
    const method = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (method !== null && current !== null) operations.push({ method: (method[1] as string).toUpperCase(), path: current });
  }
  return operations;
}

/** Placeholders that satisfy each path parameter's own pattern. */
function concrete(path: string): string {
  return path
    .replace("{runId}", "run-00000000-0000-4000-8000-000000000000")
    .replace("{bundleRoot}", `0x${"0".repeat(64)}`)
    .replace("{chainId}", "16661");
}

let base = "";
let server: ReturnType<typeof startServer>;

beforeAll(() => {
  server = startServer(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe("openapi contract", () => {
  it("documents at least the routes worth promising", () => {
    expect(documentedOperations().length).toBeGreaterThanOrEqual(8);
  });

  it("routes every operation the spec advertises", async () => {
    const unrouted: string[] = [];
    for (const { method, path } of documentedOperations()) {
      const response = await fetch(`${base}${concrete(path)}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "GET" ? {} : { body: "{}" }),
      });
      // A 404 alone proves nothing: these placeholder ids do not exist, so a routed
      // handler answers "No such run." and that is correct. Only the catch-all says
      // "No route for METHOD PATH", so that string is the one honest signal that the
      // spec advertises something the server never dispatches.
      const body = await response.text();
      if (body.includes("No route for")) unrouted.push(`${method} ${path} -> unrouted`);
    }
    expect(unrouted, `Spec advertises routes the server does not serve:\n${unrouted.join("\n")}`).toEqual([]);
  });

  it("advertises the port the server actually defaults to", () => {
    // startServer's default lives in one place; if it moves, the spec must move too.
    const declared = /url:\s*http:\/\/[\d.]+:(\d+)/.exec(spec)?.[1];
    expect(declared, "openapi.yaml must declare a server URL with a port").toBeDefined();
    expect(Number(declared)).toBe(8787);
  });
});
