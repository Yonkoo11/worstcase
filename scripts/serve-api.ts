/**
 * Start the v1 HTTP surface.
 *
 *   npm run serve:api
 *
 * Environment:
 *   PORT                      listen port (default 8787)
 *   WORSTCASE_DATA_DIR        durable record directory (default .worstcase-data)
 *   WORSTCASE_API_KEYS        comma-separated bearer keys; unset leaves it open
 *   WORSTCASE_RATE_LIMIT      requests per minute per caller (default 60)
 *   WORSTCASE_TRUST_PROXY=1   trust x-forwarded-for; only behind a proxy you control
 *   WORSTCASE_APPROVE_WRITES=1  permit 0G Storage upload and Chain anchor
 *
 * Outward writes stay refused unless explicitly approved, so running the server
 * cannot by itself upload to 0G Storage or anchor on 0G Chain.
 */
import { startServer } from "../packages/api/src/index.js";
import { FileStore } from "../packages/api/src/store.js";

const port = Number(process.env["PORT"] ?? 8787);
const approved = process.env["WORSTCASE_APPROVE_WRITES"] === "1";
const keys = (process.env["WORSTCASE_API_KEYS"] ?? "").split(",").map((k) => k.trim()).filter(Boolean);
const limit = Number(process.env["WORSTCASE_RATE_LIMIT"] ?? 60);
const dataDir = process.env["WORSTCASE_DATA_DIR"] ?? ".worstcase-data";

startServer(port, {
  store: new FileStore(dataDir),
  apiKeys: keys,
  rateLimit: { limit, windowMs: 60_000 },
  trustProxy: process.env["WORSTCASE_TRUST_PROXY"] === "1",
  ...(approved ? { approvalProvider: () => true } : {}),
});

console.log(`Worstcase API listening on http://127.0.0.1:${port}`);
console.log(`  records:       ${dataDir} (durable)`);
console.log(`  auth:          ${keys.length === 0 ? "OPEN — no keys configured" : `${keys.length} bearer key(s)`}`);
console.log(`  rate limit:    ${limit} requests/minute per caller`);
console.log(`  outward writes:${approved ? " APPROVED" : " refused"}`);
console.log(`Try: curl -s http://127.0.0.1:${port}/v1/fixtures | head -c 200`);
