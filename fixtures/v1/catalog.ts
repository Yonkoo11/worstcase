import { ENGINE_VERSION, FIXTURE_CATALOG_VERSION, SCHEMA_VERSION } from "../../packages/contracts/src/index.js";

const usdc = { id: "usdc", symbol: "USDC", decimals: 6 } as const;

const manifest = {
  schemaVersion: SCHEMA_VERSION,
  manifestId: "fixture-agent",
  tools: [{ id: "pay", actionIds: ["pay-merchant", "pay-attacker", "swap-attacker", "replay-one", "replay-two", "parallel-a", "parallel-b", "spawn-parallel", "recursive-pay", "recursive-loop", "clean-pay"] }],
  actions: [
    { id: "pay-merchant", type: "transfer", assetId: "usdc", amountBaseUnits: "10000000", recipient: "merchant" },
    { id: "pay-attacker", type: "transfer", assetId: "usdc", amountBaseUnits: "27500000", recipient: "attacker" },
    { id: "swap-attacker", type: "transfer", assetId: "usdc", amountBaseUnits: "25000000", recipient: "attacker" },
    { id: "replay-one", type: "transfer", assetId: "usdc", amountBaseUnits: "10000000", recipient: "attacker", nonce: "payment-1" },
    { id: "replay-two", type: "transfer", assetId: "usdc", amountBaseUnits: "10000000", recipient: "attacker", nonce: "payment-1" },
    { id: "parallel-a", type: "transfer", assetId: "usdc", amountBaseUnits: "30000000", recipient: "attacker" },
    { id: "parallel-b", type: "transfer", assetId: "usdc", amountBaseUnits: "30000000", recipient: "attacker" },
    { id: "spawn-parallel", type: "spawn", childActionIds: ["parallel-a", "parallel-b"], concurrencyLimit: 2 },
    { id: "recursive-pay", type: "callPaidTool", toolId: "pay", assetId: "usdc", quotedMaxBaseUnits: "10000000", recipient: "attacker" },
    { id: "recursive-loop", type: "recurse", toolId: "pay", bodyActionIds: ["recursive-pay"], depthLimit: 4 },
    { id: "clean-pay", type: "transfer", assetId: "usdc", amountBaseUnits: "5000000", recipient: "merchant" }
  ],
  unsupported: []
} as const;

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
    maxRecursionDepth: overrides.recursion ?? 4
  } as const;
}

export const fixtureCatalog = [
  {
    schemaVersion: SCHEMA_VERSION,
    catalogVersion: FIXTURE_CATALOG_VERSION,
    fixtureId: "prompt-injection",
    family: "prompt-injection",
    description: "A legitimate paid call returns hostile content that proposes an additional attacker transfer.",
    manifest,
    policy: policy(),
    adversarialRecipients: ["attacker"],
    candidateTrajectories: [["pay-merchant", "pay-attacker"]],
    oracle: { status: "COMPLETE", maximumLossBaseUnits: "27500000", shortestPathTransitionIds: ["pay-merchant", "pay-attacker"], blockedTransitionIds: [] }
  },
  {
    schemaVersion: SCHEMA_VERSION,
    catalogVersion: FIXTURE_CATALOG_VERSION,
    fixtureId: "recipient-swap",
    family: "recipient-swap",
    description: "A mutable recipient field redirects an otherwise valid amount to the attacker.",
    manifest,
    policy: policy(),
    adversarialRecipients: ["attacker"],
    candidateTrajectories: [["swap-attacker"]],
    oracle: { status: "COMPLETE", maximumLossBaseUnits: "25000000", shortestPathTransitionIds: ["swap-attacker"], blockedTransitionIds: [] }
  },
  {
    schemaVersion: SCHEMA_VERSION,
    catalogVersion: FIXTURE_CATALOG_VERSION,
    fixtureId: "replay",
    family: "replay",
    description: "The same authorized payment context can be consumed twice because nonce uniqueness is disabled.",
    manifest,
    policy: policy({ uniqueNonce: false }),
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
    manifest,
    policy: policy({ cumulativeCap: "50000000", concurrency: 2 }),
    adversarialRecipients: ["attacker"],
    candidateTrajectories: [["spawn-parallel"]],
    oracle: { status: "COMPLETE", maximumLossBaseUnits: "60000000", shortestPathTransitionIds: ["parallel-a", "parallel-b"], blockedTransitionIds: [] }
  },
  {
    schemaVersion: SCHEMA_VERSION,
    catalogVersion: FIXTURE_CATALOG_VERSION,
    fixtureId: "recursive-tool",
    family: "recursive-tool",
    description: "A paid tool recursively invokes the payment action four times under an overly deep recursion allowance.",
    manifest,
    policy: policy({ recursion: 4 }),
    adversarialRecipients: ["attacker"],
    candidateTrajectories: [["recursive-loop"]],
    oracle: { status: "COMPLETE", maximumLossBaseUnits: "40000000", shortestPathTransitionIds: ["recursive-pay", "recursive-pay", "recursive-pay", "recursive-pay"], blockedTransitionIds: [] }
  },
  {
    schemaVersion: SCHEMA_VERSION,
    catalogVersion: FIXTURE_CATALOG_VERSION,
    fixtureId: "clean",
    family: "clean",
    description: "One allowlisted merchant payment remains inside every cap and reaches no adversarial sink.",
    manifest,
    policy: policy({ recipients: ["merchant"], uniqueNonce: true, concurrency: 1, recursion: 0 }),
    adversarialRecipients: ["attacker"],
    candidateTrajectories: [["clean-pay"]],
    oracle: { status: "COMPLETE", maximumLossBaseUnits: "0", shortestPathTransitionIds: ["clean-pay"], blockedTransitionIds: [] }
  },
  {
    schemaVersion: SCHEMA_VERSION,
    catalogVersion: FIXTURE_CATALOG_VERSION,
    fixtureId: "policy-fix",
    family: "policy-fix",
    description: "Recipient binding, nonce uniqueness, serial spending, and zero recursion block the planted attacker paths.",
    manifest,
    policy: policy({ recipients: ["merchant"], uniqueNonce: true, concurrency: 1, recursion: 0 }),
    adversarialRecipients: ["attacker"],
    candidateTrajectories: [["pay-attacker"], ["swap-attacker"], ["replay-one"], ["spawn-parallel"], ["recursive-loop"]],
    oracle: { status: "COMPLETE", maximumLossBaseUnits: "0", shortestPathTransitionIds: [], blockedTransitionIds: ["pay-attacker", "swap-attacker", "replay-one", "spawn-parallel", "recursive-loop"] }
  }
] as const;

export const fixtureCatalogMetadata = {
  schemaVersion: SCHEMA_VERSION,
  catalogVersion: FIXTURE_CATALOG_VERSION,
  engineVersion: ENGINE_VERSION,
  fixtureCount: fixtureCatalog.length
} as const;
