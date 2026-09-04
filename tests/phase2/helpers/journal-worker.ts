import { FileMutationJournal } from "@worstcase/zerog";

const [mode, directory, idempotencyKey, canonicalRequestHash] = process.argv.slice(2);
if (
  (mode !== "reserve" && mode !== "reserve-and-hold") ||
  directory === undefined ||
  idempotencyKey === undefined ||
  canonicalRequestHash === undefined ||
  !/^0x[0-9a-f]{64}$/.test(canonicalRequestHash)
) {
  process.stderr.write("invalid journal worker arguments\n");
  process.exit(2);
}

const journal = new FileMutationJournal(directory);
const decision = await journal.reserve(idempotencyKey, canonicalRequestHash as `0x${string}`);
process.stdout.write(`${JSON.stringify(decision)}\n`);

if (mode === "reserve-and-hold") {
  setInterval(() => undefined, 60_000);
}
