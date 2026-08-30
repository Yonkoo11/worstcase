const surface = process.argv[2];
const messages = {
  compute: "No real 0G Compute provider request with verified response evidence has been captured.",
  storage: "No approved 0G Storage upload, proof-checked download, or explorer identifier has been captured.",
  chain: "No approved 0G Chain deployment/anchor transaction or explorer event has been captured.",
};

if (!(surface in messages)) {
  console.error("Usage: node scripts/require-live-evidence.mjs <compute|storage|chain>");
  process.exit(2);
}

console.error(`LIVE EVIDENCE REQUIRED: ${messages[surface]}`);
console.error("Local fakes and unit tests cannot satisfy this gate.");
process.exit(1);
