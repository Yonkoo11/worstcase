/**
 * Start the v1 HTTP surface.
 *
 *   npm run serve:api            # writes refused, the safe default
 *   WORSTCASE_APPROVE_WRITES=1 npm run serve:api
 *
 * Outward writes stay refused unless explicitly approved, so running the server
 * cannot by itself upload to 0G Storage or anchor on 0G Chain.
 */
import { startServer } from "../packages/api/src/index.js";

const port = Number(process.env["PORT"] ?? 8787);
const approved = process.env["WORSTCASE_APPROVE_WRITES"] === "1";

startServer(port, approved ? { approvalProvider: () => true } : {});
console.log(`Worstcase API listening on http://127.0.0.1:${port}`);
console.log(`Outward writes: ${approved ? "APPROVED" : "refused (set WORSTCASE_APPROVE_WRITES=1 to allow)"}`);
console.log(`Try: curl -s http://127.0.0.1:${port}/v1/fixtures | head -c 300`);
