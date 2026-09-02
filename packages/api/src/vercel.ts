/**
 * Serverless entry for the hosted demo.
 *
 * Durability note: a serverless instance has an ephemeral filesystem, so records
 * survive only while an instance stays warm. The hosted demo is therefore a
 * try-it-out surface, not a system of record. Run the server yourself with
 * WORSTCASE_DATA_DIR on a real disk for durable records.
 *
 * Outward writes are not approved here, so this deployment cannot upload to 0G
 * Storage or anchor on 0G Chain no matter what it is sent.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createApi } from "./index.js";
import { FileStore } from "./store.js";

const keys = (process.env["WORSTCASE_API_KEYS"] ?? "").split(",").map((k) => k.trim()).filter(Boolean);

const api = createApi({
  store: new FileStore(process.env["WORSTCASE_DATA_DIR"] ?? "/tmp/worstcase-data"),
  apiKeys: keys,
  rateLimit: { limit: Number(process.env["WORSTCASE_RATE_LIMIT"] ?? 30), windowMs: 60_000 },
  // Vercel terminates TLS and sets x-forwarded-for, so the header is trustworthy here.
  trustProxy: true,
});

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  void api.handler(req, res);
}
