import { createInterface } from "node:readline";
import { AdapterRequestSchema, AdapterResponseSchema, hashAdapterBytes } from "@worstcase/zerog";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })[Symbol.asyncIterator]();
const requestLine = await lines.next();
if (requestLine.done) process.exit(2);
const requestFrame = JSON.parse(requestLine.value) as { kind?: string; request?: unknown };
if (requestFrame.kind !== "REQUEST") process.exit(2);
const request = AdapterRequestSchema.parse(requestFrame.request);
const hashes = [`0x${"a".repeat(64)}`, `0x${"b".repeat(64)}`] as const;

for (const transactionHash of hashes) {
  process.stdout.write(`${JSON.stringify({ kind: "SUBMITTED", requestId: request.requestId, transactionHash, nonce: "7" })}\n`);
  const ackLine = await lines.next();
  if (ackLine.done) process.exit(3);
  const ack = JSON.parse(ackLine.value) as { kind?: string; requestId?: string; transactionHash?: string };
  if (ack.kind !== "ACK" || ack.requestId !== request.requestId || ack.transactionHash !== transactionHash) process.exit(4);
}

const resultBytes = Buffer.from(JSON.stringify({ acknowledged: hashes.length }));
const response = AdapterResponseSchema.parse({
  ok: true,
  requestId: request.requestId,
  resultHash: hashAdapterBytes(resultBytes),
  resultBase64: resultBytes.toString("base64"),
});
process.stdout.write(`${JSON.stringify({ kind: "RESULT", response })}\n`);
