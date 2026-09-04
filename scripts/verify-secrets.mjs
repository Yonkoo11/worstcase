/**
 * Refuse to publish a secret-shaped value.
 *
 * The file list comes from `git ls-files`, because "public" means tracked. An earlier
 * version walked five hardcoded directories and read a fixed list of root files. That
 * had two faults, both found when CI ran it on a clean clone for the first time:
 *
 *   1. Two of the required root files, AGENTS.md and CLAUDE.md, are local working
 *      notes that are deliberately untracked. They exist on the author's machine and
 *      nowhere else, so the scan crashed on a fresh checkout. It had therefore never
 *      actually run anywhere except one laptop.
 *   2. It scanned packages, tests, fixtures, docs and scripts, and nothing else.
 *      apps, contracts, evidence, brand, examples, deploy and .github were never
 *      looked at. Coverage went from 60 files to 126 when the list came from git.
 *
 * On patterns: a bare 0x-prefixed 64 hex string is NOT treated as a secret. This
 * repository publishes hundreds of them on purpose, as transaction hashes, bundle
 * roots, policy hashes and graph hashes, across 34 tracked files. A raw private key
 * has the same shape, so shape alone cannot separate them and a rule that fires on
 * shape is a rule that gets switched off. What is flagged instead is a 64 hex value
 * sitting next to a name that claims it is a key, which is what an accidental paste
 * actually looks like.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";

const SCANNABLE = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yaml", ".yml", ".md", ".sh", ".sol", ".html", ".css"]);

/** Paths that must never be tracked at all, whatever they contain. */
const FORBIDDEN_PATH = /(^|\/)(\.env($|\.)|[^/]+\.(key|pem|p12)|keystore|secrets)(\/|$)/i;

/** A shell or template dereference is a reference to a secret, not a secret. */
const DEREFERENCE = /^\$|^\$\{|^process\.env|^import\.meta\.env|^os\.getenv|^vm\.envUint/;

const PATTERNS = [
  {
    name: "vendor API key",
    test: /\b(?:app-sk-|sk-|ghp_|gho_|github_pat_)[A-Za-z0-9_-]{20,}\b/,
  },
  {
    name: "PEM private key block",
    test: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    name: "64 hex next to a name claiming it is a key",
    test: /(?:PRIVATE_KEY|SECRET_KEY|SIGNING_KEY|MNEMONIC|SEED_PHRASE|DEPLOYER|OPERATOR)[^\n]{0,40}\b0x?[0-9a-fA-F]{64}\b/i,
  },
  {
    name: "BIP39-length mnemonic assigned to a secret name",
    test: /\b(?:MNEMONIC|SEED_PHRASE)\s*[:=]\s*["'](?:\s*[a-z]+){11,}\s*["']/i,
  },
];

/** A literal value assigned to a secret-shaped name, ignoring dereferences. */
const ASSIGNMENT = /\b(PRIVATE_KEY|API_KEY|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN)\s*[:=]\s*["']([^"']{12,})["']/g;

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((path) => path !== "" && existsSync(path));

const violations = [];
let scanned = 0;

for (const path of tracked) {
  if (FORBIDDEN_PATH.test(path)) violations.push(`${path}: secret-shaped path is tracked`);
  if (!SCANNABLE.has(extname(path))) continue;

  const body = readFileSync(path, "utf8");
  scanned += 1;

  for (const { name, test } of PATTERNS) {
    if (test.test(body)) violations.push(`${path}: ${name}`);
  }

  for (const match of body.matchAll(ASSIGNMENT)) {
    const [, key, value] = match;
    if (DEREFERENCE.test(value ?? "")) continue; // PRIVATE_KEY="$DEPLOYER_KEY" is correct usage.
    violations.push(`${path}: ${key} assigned a literal value`);
  }
}

if (violations.length > 0) {
  console.error("secret scan found:");
  // Never echo the matched value; the path and the rule are enough to act on.
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}

console.log(`scanned ${scanned} tracked files of ${tracked.length}; no secret-shaped value found`);
