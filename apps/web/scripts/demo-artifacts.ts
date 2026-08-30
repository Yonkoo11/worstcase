import { readFileSync } from "node:fs";
import type { Fixture } from "../../../packages/contracts/src/index.js";
import { FixtureSchema } from "../../../packages/contracts/src/index.js";
import { compileModel } from "../../../packages/compiler/src/index.js";
import { checkFixture } from "../../../packages/checker/src/index.js";
import { createLocalEvidenceBundle } from "../../../packages/evidence/src/index.js";
import { fixtureCatalog } from "../../../fixtures/v1/catalog.js";

export type DemoAction = {
  id: string;
  type: string;
  amountBaseUnits?: string;
  recipient?: string;
  adversarial: boolean;
};

export type DemoArtifact = {
  fixtureId: string;
  family: string;
  description: string;
  engineVersion: string;
  compilationId: string;
  manifestHash: string;
  policyHash: string;
  graphHash: string;
  bundleRoot: string;
  origin: "LOCAL_FIXTURE";
  supportStatus: "SUPPORTED";
  asset: { id: string; symbol: string; decimals: number };
  protectedBalanceBaseUnits: string;
  allowedRecipients: string[];
  result: {
    status: "COMPLETE" | "UNKNOWN";
    maximumLossBaseUnits?: string;
    unknownReason?: string;
    shortestPathTransitionIds: string[];
    blocked: Array<{ transitionId: string; policyCheckId: string }>;
    exploredStates: number;
    exploredTrajectories: number;
  };
  actions: DemoAction[];
  anchor?: DemoAnchor | undefined;
};

export type DemoAnchor = {
  network: string;
  chainId: number;
  runRegistry: string;
  submitter: string;
  anchorTx: string;
  explorerTx: string;
  explorerContract: string;
};

/**
 * Read the on-chain anchor record for a fixture, when one exists.
 *
 * The records are written by contracts/anchor-0g.sh only after the anchor has
 * been read back from chain state and matched against the local run, so an
 * artifact carries an anchor exactly when a verified transaction exists.
 */
function loadAnchor(fixtureId: string): DemoAnchor | undefined {
  for (const chainId of ANCHOR_CHAIN_IDS) {
    try {
      const raw = readFileSync(`contracts/deployments/${chainId}-anchor-${fixtureId}.json`, "utf8");
      const record = JSON.parse(raw) as DemoAnchor;
      return {
        network: record.network,
        chainId: record.chainId,
        runRegistry: record.runRegistry,
        submitter: record.submitter,
        anchorTx: record.anchorTx,
        explorerTx: record.explorerTx,
        explorerContract: record.explorerContract,
      };
    } catch {
      // No anchor on this network for this fixture; try the next.
    }
  }
  return undefined;
}

// Mainnet first: if a run is anchored on both, the interface shows mainnet.
const ANCHOR_CHAIN_IDS = [16661, 16602] as const;

function actionProjection(fixture: Fixture): DemoAction[] {
  const adversarial = new Set(fixture.adversarialRecipients);
  return fixture.manifest.actions.map((action) => {
    const amountBaseUnits = action.type === "transfer"
      ? action.amountBaseUnits
      : action.type === "callPaidTool"
        ? action.quotedMaxBaseUnits
        : action.type === "approve" || action.type === "consumeBudget"
          ? action.amountBaseUnits
          : undefined;
    const recipient = action.type === "transfer" || action.type === "callPaidTool"
      ? action.recipient
      : action.type === "approve"
        ? action.spender
        : undefined;
    return {
      id: action.id,
      type: action.type,
      ...(amountBaseUnits === undefined ? {} : { amountBaseUnits }),
      ...(recipient === undefined ? {} : { recipient }),
      adversarial: recipient !== undefined && adversarial.has(recipient),
    };
  });
}

export function buildDemoArtifacts(): DemoArtifact[] {
  return fixtureCatalog.map((fixtureInput) => {
    const fixture = FixtureSchema.parse(fixtureInput);
    const compiled = compileModel(fixture.manifest, fixture.policy);
    if (compiled.status !== "SUPPORTED") throw new Error(`fixture ${fixture.fixtureId} unexpectedly unsupported`);
    const result = checkFixture(compiled, fixture);
    const evidence = createLocalEvidenceBundle(compiled, fixture, result);
    const asset = fixture.policy.assets[0];
    if (asset === undefined) throw new Error(`fixture ${fixture.fixtureId} has no asset`);
    const protectedBalanceBaseUnits = fixture.policy.protectedBalances[asset.id];
    if (protectedBalanceBaseUnits === undefined) throw new Error(`fixture ${fixture.fixtureId} has no protected balance`);
    return {
      fixtureId: fixture.fixtureId,
      family: fixture.family,
      description: fixture.description,
      engineVersion: compiled.engineVersion,
      compilationId: compiled.compilationId,
      manifestHash: compiled.manifestHash,
      policyHash: compiled.policyHash,
      graphHash: compiled.graphHash,
      bundleRoot: evidence.bundleRoot,
      origin: "LOCAL_FIXTURE",
      supportStatus: "SUPPORTED",
      asset,
      protectedBalanceBaseUnits,
      allowedRecipients: [...(fixture.policy.allowedRecipients[asset.id] ?? [])],
      result: result.status === "COMPLETE"
        ? {
            status: result.status,
            maximumLossBaseUnits: result.maximumLossBaseUnits,
            shortestPathTransitionIds: [...result.shortestPathTransitionIds],
            blocked: result.blocked.map((item) => ({ ...item })),
            exploredStates: result.exploredStates,
            exploredTrajectories: result.exploredTrajectories,
          }
        : {
            status: result.status,
            unknownReason: result.unknownReason,
            shortestPathTransitionIds: [],
            blocked: [],
            exploredStates: result.exploredStates,
            exploredTrajectories: result.exploredTrajectories,
          },
      actions: actionProjection(fixture),
      anchor: loadAnchor(fixture.fixtureId),
    };
  });
}
