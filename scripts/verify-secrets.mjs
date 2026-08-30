import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const roots = ["packages", "tests", "fixtures", "docs", "scripts"];
const rootFiles = ["package.json", "tsconfig.json", "verify.sh", "AGENTS.md", "CLAUDE.md", "SECURITY.md"];
const allowedExtensions = new Set([".ts", ".js", ".mjs", ".json", ".yaml", ".yml", ".md", ".sh"]);
const forbiddenNames = /(^|\/)(\.env($|\.)|[^/]+\.(key|pem)|keystore|secrets)(\/|$)/i;
const secretPatterns = [
  /\b(?:app-sk-|sk-)[A-Za-z0-9_-]{20,}\b/,
  /\b0x[0-9a-fA-F]{64}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:PRIVATE_KEY|API_KEY|SECRET_KEY|ACCESS_TOKEN)\s*[:=]\s*["'][^"']{12,}["']/,
];

async function walk(path) {
  const entries = await readdir(path);
  const files = [];
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") continue;
    const child = join(path, entry);
    const info = await stat(child);
    if (info.isDirectory()) files.push(...await walk(child));
    else files.push(child);
  }
  return files;
}

for (const root of roots) {
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`required scan root missing: ${root}`);
}

const candidates = [...rootFiles, ...(await Promise.all(roots.map(walk))).flat()];
const violations = [];
for (const file of candidates) {
  const normalized = relative(process.cwd(), file);
  if (forbiddenNames.test(normalized)) violations.push(`${normalized}: secret-shaped path`);
  if (!allowedExtensions.has(extname(file)) && !rootFiles.includes(file)) continue;
  const body = await readFile(file, "utf8");
  for (const pattern of secretPatterns) if (pattern.test(body)) violations.push(`${normalized}: matches ${pattern.source}`);
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`scanned ${candidates.length} public/source files; no secret-shaped value found`);
