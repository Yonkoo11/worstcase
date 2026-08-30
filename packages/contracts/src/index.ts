import { createHash } from "node:crypto";
import { z } from "zod";

export const SCHEMA_VERSION = "1" as const;
export const FIXTURE_CATALOG_VERSION = "1" as const;
export const ENGINE_VERSION = "0.1.0-contract" as const;

export const Identifier = z.string().regex(/^[a-z][a-z0-9._:-]{0,127}$/);
export const MoneyBaseUnits = z.string().regex(/^(0|[1-9][0-9]*)$/).max(79);
export const HashHex = z.string().regex(/^0x[0-9a-f]{64}$/);

export const AssetSchema = z
  .object({ id: Identifier, symbol: z.string().regex(/^[A-Z0-9]{1,12}$/), decimals: z.number().int().min(0).max(36) })
  .strict();

const TransferAction = z.object({
  id: Identifier,
  type: z.literal("transfer"),
  assetId: Identifier,
  amountBaseUnits: MoneyBaseUnits,
  recipient: Identifier,
  nonce: Identifier.optional(),
}).strict();

const ApproveAction = z.object({
  id: Identifier,
  type: z.literal("approve"),
  assetId: Identifier,
  amountBaseUnits: MoneyBaseUnits,
  spender: Identifier,
}).strict();

const PaidToolAction = z.object({
  id: Identifier,
  type: z.literal("callPaidTool"),
  toolId: Identifier,
  assetId: Identifier,
  quotedMaxBaseUnits: MoneyBaseUnits,
  recipient: Identifier,
}).strict();

const ConsumeBudgetAction = z.object({
  id: Identifier,
  type: z.literal("consumeBudget"),
  scope: Identifier,
  assetId: Identifier,
  amountBaseUnits: MoneyBaseUnits,
}).strict();

const AdvanceNonceAction = z.object({ id: Identifier, type: z.literal("advanceNonce"), scope: Identifier }).strict();
const SpawnAction = z.object({
  id: Identifier,
  type: z.literal("spawn"),
  childActionIds: z.array(Identifier).min(1).max(16),
  concurrencyLimit: z.number().int().min(1).max(16),
}).strict();
const RecurseAction = z.object({
  id: Identifier,
  type: z.literal("recurse"),
  toolId: Identifier,
  bodyActionIds: z.array(Identifier).min(1).max(16),
  depthLimit: z.number().int().min(1).max(16),
}).strict();

export const SupportedActionSchema = z.discriminatedUnion("type", [
  TransferAction,
  ApproveAction,
  PaidToolAction,
  ConsumeBudgetAction,
  AdvanceNonceAction,
  SpawnAction,
  RecurseAction,
]);

export const ManifestProjectionSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  manifestId: Identifier,
  tools: z.array(z.object({ id: Identifier, actionIds: z.array(Identifier).max(64) }).strict()).max(64),
  actions: z.array(SupportedActionSchema).max(256),
  unsupported: z.array(z.object({ path: z.string().min(1).max(256), reason: z.string().min(1).max(256) }).strict()).max(256),
}).strict().superRefine((value, context) => {
  const actionIds = value.actions.map((action) => action.id);
  if (new Set(actionIds).size !== actionIds.length) context.addIssue({ code: "custom", message: "action ids must be unique", path: ["actions"] });
  const known = new Set(actionIds);
  for (const [toolIndex, tool] of value.tools.entries()) {
    for (const [actionIndex, actionId] of tool.actionIds.entries()) {
      if (!known.has(actionId)) context.addIssue({ code: "custom", message: "tool references unknown action", path: ["tools", toolIndex, "actionIds", actionIndex] });
    }
  }
});

export const SpendPolicySchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  policyId: Identifier,
  assets: z.array(AssetSchema).min(1).max(16),
  protectedBalances: z.record(Identifier, MoneyBaseUnits),
  allowedRecipients: z.record(Identifier, z.array(Identifier).max(128)),
  perActionCaps: z.record(Identifier, MoneyBaseUnits),
  cumulativeCaps: z.record(Identifier, MoneyBaseUnits),
  requireUniqueNonce: z.boolean(),
  maxConcurrency: z.number().int().min(1).max(16),
  maxRecursionDepth: z.number().int().min(0).max(16),
}).strict();

export const ExplorationLimitsSchema = z.object({
  maxDepth: z.number().int().min(1).max(128),
  maxStates: z.number().int().min(1).max(1_000_000),
  maxBranches: z.number().int().min(1).max(256),
  maxConcurrency: z.number().int().min(1).max(16),
  timeoutMs: z.number().int().min(1).max(60_000),
}).strict();

export const EconomicStateSchema = z.object({
  balances: z.record(Identifier, MoneyBaseUnits),
  cumulativeSpend: z.record(Identifier, MoneyBaseUnits),
  approvals: z.record(Identifier, MoneyBaseUnits),
  consumedNonces: z.array(Identifier).max(1024),
  activeCalls: z.number().int().min(0).max(16),
  recursionDepth: z.number().int().min(0).max(16),
  terminal: z.boolean(),
}).strict();

export const TransitionSchema = z.object({
  id: Identifier,
  fromStateId: Identifier,
  toStateId: Identifier,
  actionId: Identifier,
  policyCheckIds: z.array(Identifier).max(16),
  externalLossBaseUnits: MoneyBaseUnits,
}).strict();

export const EconomicGraphSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  engineVersion: z.string().min(1).max(64),
  policyHash: HashHex,
  manifestHash: HashHex,
  actionIds: z.array(Identifier).max(256),
  limits: ExplorationLimitsSchema,
}).strict().superRefine((value, context) => {
  const sorted = [...value.actionIds].sort((left, right) => left.localeCompare(right));
  if (new Set(value.actionIds).size !== value.actionIds.length) {
    context.addIssue({ code: "custom", message: "graph action ids must be unique", path: ["actionIds"] });
  }
  if (value.actionIds.some((actionId, index) => actionId !== sorted[index])) {
    context.addIssue({ code: "custom", message: "graph action ids must be canonically sorted", path: ["actionIds"] });
  }
});

export const FixtureSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  catalogVersion: z.literal(FIXTURE_CATALOG_VERSION),
  fixtureId: Identifier,
  family: z.enum(["prompt-injection", "recipient-swap", "replay", "concurrency", "recursive-tool", "clean", "policy-fix"]),
  description: z.string().min(1).max(280),
  manifest: ManifestProjectionSchema,
  policy: SpendPolicySchema,
  adversarialRecipients: z.array(Identifier).min(1).max(32),
  candidateTrajectories: z.array(z.array(Identifier).min(1).max(64)).min(1).max(64),
  oracle: z.object({
    status: z.enum(["COMPLETE", "UNKNOWN"]),
    maximumLossBaseUnits: MoneyBaseUnits.optional(),
    shortestPathTransitionIds: z.array(Identifier).max(64),
    blockedTransitionIds: z.array(Identifier).max(64),
    expectedUnknownReason: Identifier.optional(),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.oracle.status === "COMPLETE" && value.oracle.maximumLossBaseUnits === undefined) {
    context.addIssue({ code: "custom", message: "complete oracle requires maximum loss", path: ["oracle", "maximumLossBaseUnits"] });
  }
  if (value.oracle.status === "UNKNOWN" && value.oracle.maximumLossBaseUnits !== undefined) {
    context.addIssue({ code: "custom", message: "unknown oracle cannot include maximum loss", path: ["oracle", "maximumLossBaseUnits"] });
  }
});

export const RunStageSchema = z.enum(["DRAFT", "COMPILED", "QUEUED", "PROBING", "CHECKING", "COMPLETE", "UNKNOWN", "FAILED", "STORING", "STORED", "ANCHOR_PENDING", "ANCHORED", "RETRYABLE_FAILURE"]);
export const UnknownReasonSchema = z.enum(["UNSUPPORTED_ACTION", "MAX_DEPTH", "MAX_STATES", "MAX_BRANCHES", "MAX_CONCURRENCY", "TIMEOUT", "PROVIDER_EVIDENCE_INVALID", "SEARCH_INCOMPLETE"]);

export const CounterexampleSchema = z.object({
  maximumLossBaseUnits: MoneyBaseUnits,
  transitionIds: z.array(Identifier),
  blocked: z.array(z.object({ transitionId: Identifier, policyCheckId: Identifier }).strict()),
}).strict();

export const RunSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  engineVersion: z.string().min(1).max(64),
  runId: Identifier,
  stage: RunStageSchema,
  manifestHash: HashHex,
  policyHash: HashHex,
  graphHash: HashHex,
  fixtureIds: z.array(Identifier).min(1).max(7),
  limits: ExplorationLimitsSchema,
  counterexample: CounterexampleSchema.optional(),
  unknownReason: UnknownReasonSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.stage === "COMPLETE" && value.counterexample === undefined) context.addIssue({ code: "custom", message: "complete run requires counterexample", path: ["counterexample"] });
  if (value.stage === "COMPLETE" && value.unknownReason !== undefined) context.addIssue({ code: "custom", message: "complete run cannot contain unknown reason", path: ["unknownReason"] });
  if (value.stage === "UNKNOWN" && value.unknownReason === undefined) context.addIssue({ code: "custom", message: "unknown run requires reason", path: ["unknownReason"] });
  if (value.stage === "UNKNOWN" && value.counterexample !== undefined) context.addIssue({ code: "custom", message: "unknown run cannot contain counterexample", path: ["counterexample"] });
});

export const EvidenceBundleSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  engineVersion: z.string().min(1).max(64),
  origin: z.enum(["LOCAL_FIXTURE", "ZEROG_COMPUTE"]),
  run: RunSchema,
  manifest: ManifestProjectionSchema,
  policy: SpendPolicySchema,
  graph: EconomicGraphSchema,
  fixtures: z.array(FixtureSchema).min(1).max(7),
  acceptedCandidateHashes: z.array(HashHex).max(1024),
  rejectedCandidates: z.array(z.object({ hash: HashHex, reason: Identifier }).strict()).max(1024),
  providerEvidence: z.object({
    providerId: z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/),
    requestHash: HashHex,
    responseHash: HashHex,
    transitionIds: z.array(Identifier).max(64),
    provenanceHash: HashHex,
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (value.run.stage !== "COMPLETE" && value.run.stage !== "UNKNOWN") {
    context.addIssue({ code: "custom", message: "evidence requires a terminal analytical run", path: ["run", "stage"] });
  }
  if (value.engineVersion !== value.run.engineVersion || value.graph.engineVersion !== value.run.engineVersion) {
    context.addIssue({ code: "custom", message: "evidence engine versions must match", path: ["engineVersion"] });
  }
  if (value.origin === "ZEROG_COMPUTE" && value.providerEvidence === undefined) {
    context.addIssue({ code: "custom", message: "0G Compute origin requires provider evidence", path: ["providerEvidence"] });
  }
  if (value.origin === "LOCAL_FIXTURE" && value.providerEvidence !== undefined) {
    context.addIssue({ code: "custom", message: "local fixture evidence cannot claim provider evidence", path: ["providerEvidence"] });
  }
});

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) throw new TypeError("canonical JSON permits safe integers only");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) throw new TypeError("canonical JSON rejects undefined");
      result[key] = canonicalValue(child);
    }
    return result;
  }
  throw new TypeError(`canonical JSON rejects ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function canonicalHash(value: unknown): `0x${string}` {
  return `0x${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export type Fixture = z.infer<typeof FixtureSchema>;
export type EconomicGraph = z.infer<typeof EconomicGraphSchema>;
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;
export type Run = z.infer<typeof RunSchema>;
