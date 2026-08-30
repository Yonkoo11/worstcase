import {
  ENGINE_VERSION,
  ExplorationLimitsSchema,
  ManifestProjectionSchema,
  SpendPolicySchema,
  canonicalHash,
  type Fixture,
  type EconomicGraph,
} from "../../contracts/src/index.js";

type Manifest = Fixture["manifest"];
type Policy = Fixture["policy"];
type Action = Manifest["actions"][number];

export const DEFAULT_LIMITS = ExplorationLimitsSchema.parse({
  maxDepth: 64,
  maxStates: 50_000,
  maxBranches: 64,
  maxConcurrency: 8,
  timeoutMs: 10_000,
});

export type CompilationIssue = { path: string; code: string; message: string };

export type CompiledModel = {
  status: "SUPPORTED";
  compilationId: `0x${string}`;
  graphHash: `0x${string}`;
  manifestHash: `0x${string}`;
  policyHash: `0x${string}`;
  engineVersion: string;
  graph: EconomicGraph;
  manifest: Manifest;
  policy: Policy;
  actions: ReadonlyMap<string, Action>;
  limits: typeof DEFAULT_LIMITS;
};

export type UnsupportedCompilation = {
  status: "UNSUPPORTED";
  manifestHash: `0x${string}`;
  policyHash: `0x${string}`;
  issues: CompilationIssue[];
};

function semanticIssues(manifest: Manifest, policy: Policy): CompilationIssue[] {
  const issues: CompilationIssue[] = manifest.unsupported.map((item) => ({ path: item.path, code: "DECLARED_UNSUPPORTED", message: item.reason }));
  const assets = new Set(policy.assets.map((asset) => asset.id));
  const actionIds = new Set(manifest.actions.map((action) => action.id));

  for (const [index, action] of manifest.actions.entries()) {
    if ("assetId" in action && !assets.has(action.assetId)) issues.push({ path: `/actions/${index}/assetId`, code: "UNKNOWN_ASSET", message: `asset ${action.assetId} is not declared by policy` });
    if (action.type === "spawn") for (const child of action.childActionIds) if (!actionIds.has(child)) issues.push({ path: `/actions/${index}/childActionIds`, code: "UNKNOWN_ACTION", message: `spawn child ${child} does not exist` });
    if (action.type === "recurse") for (const child of action.bodyActionIds) if (!actionIds.has(child)) issues.push({ path: `/actions/${index}/bodyActionIds`, code: "UNKNOWN_ACTION", message: `recursive body ${child} does not exist` });
  }
  return issues.sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`));
}

export function compileModel(manifestInput: unknown, policyInput: unknown, limitsInput: unknown = DEFAULT_LIMITS): CompiledModel | UnsupportedCompilation {
  const manifest = ManifestProjectionSchema.parse(manifestInput) as Manifest;
  const policy = SpendPolicySchema.parse(policyInput) as Policy;
  const limits = ExplorationLimitsSchema.parse(limitsInput);
  const manifestHash = canonicalHash(manifest);
  const policyHash = canonicalHash(policy);
  const issues = semanticIssues(manifest, policy);
  if (issues.length > 0) return { status: "UNSUPPORTED", manifestHash, policyHash, issues };

  const sortedActions = [...manifest.actions].sort((left, right) => left.id.localeCompare(right.id));
  const graph = { schemaVersion: manifest.schemaVersion, engineVersion: ENGINE_VERSION, manifestHash, policyHash, actionIds: sortedActions.map((action) => action.id), limits } satisfies EconomicGraph;
  const graphHash = canonicalHash(graph);
  return {
    status: "SUPPORTED",
    compilationId: canonicalHash({ manifestHash, policyHash, graphHash, engineVersion: ENGINE_VERSION }),
    graphHash,
    manifestHash,
    policyHash,
    engineVersion: ENGINE_VERSION,
    graph,
    manifest,
    policy,
    actions: new Map(sortedActions.map((action) => [action.id, action])),
    limits,
  };
}
