/**
 * Run Worstcase against your own agent.
 *
 *   npx vite-node scripts/check-agent.ts --manifest a.json --policy p.json --adversarial attacker
 *
 * Prints the maximum value that can reach a declared adversarial recipient, the
 * shortest sequence of calls that reaches it, and which policy rules blocked the
 * alternatives. Nothing is uploaded and nothing is signed.
 *
 * Exit codes: 0 no reachable loss, 1 a loss is reachable, 2 the answer is
 * UNKNOWN, 3 the model could not be compiled. UNKNOWN is deliberately not 0:
 * "we could not finish the analysis" must never be read as "safe".
 */
import { readFileSync } from "node:fs";
import { compileModel, DEFAULT_LIMITS } from "../packages/compiler/src/index.js";
import { searchMaximumLoss } from "../packages/checker/src/index.js";

type Args = Record<string, string | boolean>;

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined || !token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { args[key] = true; continue; }
    args[key] = next;
    i += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const manifestPath = args["manifest"];
const policyPath = args["policy"];

if (typeof manifestPath !== "string" || typeof policyPath !== "string") {
  console.error("usage: check-agent.ts --manifest <file> --policy <file> [--adversarial a,b] [--json]");
  console.error("       [--max-depth N] [--max-states N] [--timeout-ms N]");
  process.exit(3);
}

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`Could not read ${path}: ${(error as Error).message}`);
    process.exit(3);
  }
};

const limits = {
  ...DEFAULT_LIMITS,
  ...(typeof args["max-depth"] === "string" ? { maxDepth: Number(args["max-depth"]) } : {}),
  ...(typeof args["max-states"] === "string" ? { maxStates: Number(args["max-states"]) } : {}),
  ...(typeof args["timeout-ms"] === "string" ? { timeoutMs: Number(args["timeout-ms"]) } : {}),
};

let compiled: ReturnType<typeof compileModel>;
try {
  compiled = compileModel(readJson(manifestPath), readJson(policyPath), limits);
} catch (error) {
  console.error(`Model rejected: ${(error as Error).message}`);
  process.exit(3);
}

if (compiled.status !== "SUPPORTED") {
  // The compiler refuses rather than guessing. An action it cannot model is not
  // quietly dropped, because dropping it would silently lower the bound.
  console.error("Model is not fully supported, so no bound is reported.");
  for (const issue of compiled.issues) console.error(`  ${issue.path}: ${issue.code} — ${issue.message}`);
  process.exit(3);
}

const adversarial = typeof args["adversarial"] === "string"
  ? args["adversarial"].split(",").map((s) => s.trim()).filter(Boolean)
  : [];

if (adversarial.length === 0) {
  console.error("Specify at least one adversarial recipient with --adversarial, otherwise nothing counts as loss.");
  process.exit(3);
}

const result = searchMaximumLoss(compiled, adversarial);

if (args["json"] === true) {
  console.log(JSON.stringify({ ...result, manifestHash: compiled.manifestHash, policyHash: compiled.policyHash, graphHash: compiled.graphHash, limits }, null, 2));
} else if (result.status === "UNKNOWN") {
  console.log(`Result:        UNKNOWN (${result.unknownReason})`);
  console.log(`Explored:      ${result.exploredStates} states`);
  console.log("");
  console.log("The search did not finish, so no bound is claimed. This is not a pass.");
  console.log("Raise --max-states or --max-depth, or narrow the model, and run it again.");
} else {
  const decimals = compiled.policy.assets[0]?.decimals ?? 0;
  const symbol = compiled.policy.assets[0]?.symbol ?? "";
  const scaled = (Number(BigInt(result.maximumLossBaseUnits)) / 10 ** decimals).toFixed(Math.min(decimals, 2));
  console.log(`Maximum loss:  ${result.maximumLossBaseUnits} base units (${scaled} ${symbol})`);
  console.log(`Explored:      ${result.exploredStates} reachable states`);
  console.log(`Shortest path: ${result.shortestPathTransitionIds.length === 0 ? "(none — no adversarial recipient is reachable)" : result.shortestPathTransitionIds.join(" -> ")}`);
  if (result.blocked.length > 0) {
    console.log("Blocked by policy:");
    for (const item of result.blocked) console.log(`  ${item.transitionId.padEnd(24)} ${item.policyCheckId}`);
  }
  console.log("");
  console.log(`graphHash:     ${compiled.graphHash}`);
  console.log(`policyHash:    ${compiled.policyHash}`);
}

process.exit(result.status === "UNKNOWN" ? 2 : BigInt(result.maximumLossBaseUnits) > 0n ? 1 : 0);
