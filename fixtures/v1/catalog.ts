import { ENGINE_VERSION, FIXTURE_CATALOG_VERSION, SCHEMA_VERSION } from "../../packages/contracts/src/index.js";

const usdc = { id: "usdc", symbol: "USDC", decimals: 6 } as const;

/**
 * Each fixture is its own small agent.
 *
 * An earlier version shared one eleven-action manifest across every fixture and
 * handed each one a different hand-written trajectory. Once the checker searches
 * the reachable states instead of replaying declared paths, that design collapses:
 * fixtures sharing a manifest and policy must produce the same bound, because the
 * bound is a property of the model, not of which path someone remembered to write
 * down. Isolating each family makes the family the binding constraint, so the
 * number each fixture reports is genuinely about the vulnerability it plants.
 */
function agent(manifestId: string, actions: readonly Record<string, unknown>[]) {
  return {
    schemaVersion: SCHEMA_VERSION,
    manifestId,
    tools: [{ id: "pay", actionIds: actions.map((a) => a["id"] as string) }],
    actions,
    unsupported: [],
  } as const;
}

function policy(overrides: Partial<{
  recipients: string[];
  perActionCap: string;
  cumulativeCap: string;
  uniqueNonce: boolean;
  concurrency: number;
  recursion: number;
}> = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    policyId: "fixture-policy",
    assets: [usdc],
    protectedBalances: { usdc: "100000000" },
    allowedRecipients: { usdc: overrides.recipients ?? ["merchant", "attacker"] },
    perActionCaps: { usdc: overrides.perActionCap ?? "50000000" },
    cumulativeCaps: { usdc: overrides.cumulativeCap ?? "100000000" },
    requireUniqueNonce: overrides.uniqueNonce ?? false,
    maxConcurrency: overrides.concurrency ?? 2,
    maxRecursionDepth: overrides.recursion ?? 4,
  } as const;
}

const payMerchant = { id: "pay-merchant", type: "transfer", assetId: "usdc", amountBaseUnits: "10000000", recipient: "merchant" } as const;

// Injected extra transfer. Nothing else in this agent can reach the attacker,
// so the bound is exactly the injected payment.
const injectionAgent = agent("agent-prompt-injection", [
  payMerchant,
  { id: "pay-attacker", type: "transfer", assetId: "usdc", amountBaseUnits: "27500000", recipient: "attacker" },
]);

// A single mutable-recipient payment.
const swapAgent = agent("agent-recipient-swap", [
  payMerchant,
  { id: "swap-attacker", type: "transfer", assetId: "usdc", amountBaseUnits: "25000000", recipient: "attacker" },
]);

// Two submissions carrying the same nonce. With uniqueness off, both settle.
const replayAgent = agent("agent-replay", [
  { id: "replay-one", type: "transfer", assetId: "usdc", amountBaseUnits: "10000000", recipient: "attacker", nonce: "payment-1" },
  { id: "replay-two", type: "transfer", assetId: "usdc", amountBaseUnits: "10000000", recipient: "attacker", nonce: "payment-1" },
]);

// Two payments that each pass the cumulative cap against the same pre-spawn view.
const concurrencyAgent = agent("agent-concurrency", [
  { id: "parallel-a", type: "transfer", assetId: "usdc", amountBaseUnits: "30000000", recipient: "attacker" },
  { id: "parallel-b", type: "transfer", assetId: "usdc", amountBaseUnits: "30000000", recipient: "attacker" },
  { id: "spawn-parallel", type: "spawn", childActionIds: ["parallel-a", "parallel-b"], concurrencyLimit: 2 },
]);

// A paid tool that re-enters itself up to the policy's recursion depth.
const recursiveAgent = agent("agent-recursive-tool", [
  { id: "recursive-pay", type: "callPaidTool", toolId: "pay", assetId: "usdc", quotedMaxBaseUnits: "10000000", recipient: "attacker" },
  { id: "recursive-loop", type: "recurse", toolId: "pay", bodyActionIds: ["recursive-pay"], depthLimit: 4 },
]);

// No action in this agent can reach a declared adversarial recipient.
const cleanAgent = agent("agent-clean", [
  payMerchant,
  { id: "clean-pay", type: "transfer", assetId: "usdc", amountBaseUnits: "5000000", recipient: "merchant" },
]);

export const fixtureCatalog = [
  {
    schemaVersion: SCHEMA_VERSION,
    catalogVersion: FIXTURE_CATALOG_VERSION,
    fixtureId: "prompt-injection",
    family: "prompt-injection",
    description: "A legitimate paid call returns hostile content that proposes an additional attacker transfer.",
    manifest: injectionAgent,
    policy: policy({ concurrency: 1, recursion: 0, uniqueNonce: true }),
    adversarialRecipients: ["attacker"],
    candidateTrajectories: [["pay-merchant", "pay-attacker"]],
    oracle: { status: "COMPLETE", maximumLossBaseUnits: "27500000", shortestPathTransitionIds: ["pay-attacker"], blockedTransitionIds: [] }
  },
  {
    schemaVersion: SCHEMA_VERSION,
    catalogVersion: FIXTURE_CATALOG_VERSION,
    fixtureId: "recipient-swap",
    family: "recipient-swap",
    description: "A mutable recipient field redirects an otherwise valid amount to the attacker.",
    manifest: swapAgent,
    policy: policy({ concurrency: 1, recursion: 0, uniqueNonce: true }),
    adversarialRecipients: ["attacker"],
    candidateTrajectories: [["swap-attacker"]],
    oracle: { status: "COMPLETE", maximumLossBaseUnits: "25000000", shortestPathTransitionIds: ["swap-attacker"], blockedTransitionIds: [] }
  },
  {
    schemaVersion: SCHEMA_VERSION,
    catalogVersion: FIXTURE_CATALOG_VERSION,
    fixtureId: "replay",
    family: "replay",
    description: "The same signed payment intent can be consumed twice because nonce uniqueness is disabled.",
    manifest: replayAgent,
    policy: policy({ uniqueNonce: false, concurrency: 1, recursion: 0 }),
    adversarialRecipients: ["attacker"],
    candidateTrajectories: [["replay-one", "replay-two"]],
    oracle: { status: "COMPLETE", maximumLossBaseUnits: "20000000", shortestPathTransitionIds: ["replay-one", "replay-two"], blockedTransitionIds: [] }
  },
  {
    schemaVersion: SCHEMA_VERSION,
    catalogVersion: FIXTURE_CATALOG_VERSION,
    fixtureId: "concurrency",
    family: "concurrency",
    description: "Two parallel payments both observe the pre-spend cumulative budget and commit together.",
    manifest: concurrencyAgent,
    policy: policy({ cumulativeCap: "50000000", concurrency: 2, recursion: 0, uniqueNonce: true }),
    adversarialRecipients: ["attacker"],
    candidateTrajectories: [["spawn-parallel"]],
    oracle: { status: "COMPLETE", maximumLossBaseUnits: "60000000", shortestPathTransitionIds: ["parallel-a", "parallel-b"], blockedTransitionIds: ["parallel-a", "parallel-b"] }
  },
  {
    schemaVersion: SCHEMA_VERSION,
    catalogVersion: FIXTURE_CATALOG_VERSION,
    fixtureId: "recursive-tool",
    family: "recursive-tool",
    description: "A paid tool re-enters itself under an overly deep recursion allowance.",
    manifest: recursiveAgent,
    policy: policy({ recursion: 4, cumulativeCap: "40000000", concurrency: 1, uniqueNonce: true }),
    adversarialRecipients: ["attacker"],
    candidateTrajectories: [["recursive-loop"]],
    oracle: { status: "COMPLETE", maximumLossBaseUnits: "40000000", shortestPathTransitionIds: ["recursive-pay", "recursive-pay", "recursive-pay", "recursive-pay"], blockedTransitionIds: ["recursive-pay"] }
  },
  {
    schemaVersion: SCHEMA_VERSION,
    catalogVersion: FIXTURE_CATALOG_VERSION,
    fixtureId: "clean",
    family: "clean",
    description: "A well scoped merchant agent where no declared adversarial recipient is reachable.",
    manifest: cleanAgent,
    policy: policy({ recipients: ["merchant"], uniqueNonce: true, concurrency: 1, recursion: 0 }),
    adversarialRecipients: ["attacker"],
    candidateTrajectories: [["clean-pay"]],
    oracle: { status: "COMPLETE", maximumLossBaseUnits: "0", shortestPathTransitionIds: [], blockedTransitionIds: [] }
  },
  {
    schemaVersion: SCHEMA_VERSION,
    catalogVersion: FIXTURE_CATALOG_VERSION,
    fixtureId: "policy-fix",
    family: "policy-fix",
    description: "The prompt-injection agent after one policy edge is tightened: the attacker is no longer an allowed recipient.",
    manifest: injectionAgent,
    policy: policy({ recipients: ["merchant"], uniqueNonce: true, concurrency: 1, recursion: 0 }),
    adversarialRecipients: ["attacker"],
    candidateTrajectories: [["pay-merchant", "pay-attacker"]],
    oracle: { status: "COMPLETE", maximumLossBaseUnits: "0", shortestPathTransitionIds: [], blockedTransitionIds: ["pay-attacker"] }
  }
] as const;

export const fixtureCatalogMetadata = {
  schemaVersion: SCHEMA_VERSION,
  catalogVersion: FIXTURE_CATALOG_VERSION,
  engineVersion: ENGINE_VERSION,
  fixtureCount: fixtureCatalog.length
} as const;
