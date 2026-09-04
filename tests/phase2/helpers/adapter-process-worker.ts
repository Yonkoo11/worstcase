import { AdapterRequestSchema, AdapterResponseSchema, hashAdapterBytes } from "@worstcase/zerog";

const mode = process.argv[2];
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const request = AdapterRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));

if (mode === "timeout") {
  setInterval(() => undefined, 60_000);
} else if (mode === "malformed") {
  process.stdout.write("not-json\n");
} else if (mode === "oversized") {
  process.stdout.write("x".repeat(4_096));
} else {
  const resultBytes = Buffer.from(JSON.stringify({
    allowed: process.env.WORSTCASE_ALLOWED === "yes",
    inherited: process.env.WORSTCASE_PARENT_SENTINEL !== undefined,
  }));
  process.stdout.write(`${JSON.stringify(AdapterResponseSchema.parse({
    ok: true,
    requestId: request.requestId,
    resultHash: mode === "hash-mismatch" ? `0x${"f".repeat(64)}` : hashAdapterBytes(resultBytes),
    resultBase64: resultBytes.toString("base64"),
  }))}\n`);
}
