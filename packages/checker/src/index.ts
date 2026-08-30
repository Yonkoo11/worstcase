import { FixtureSchema, type Fixture } from "../../contracts/src/index.js";
import type { CompiledModel } from "../../compiler/src/index.js";

type Action = CompiledModel["manifest"]["actions"][number];
type Policy = CompiledModel["policy"];

type SearchState = {
  balances: Map<string, bigint>;
  cumulativeSpend: Map<string, bigint>;
  approvals: Map<string, bigint>;
  consumedNonces: Set<string>;
  loss: bigint;
  path: string[];
  blocked: Array<{ transitionId: string; policyCheckId: string }>;
};

export type CompleteResult = {
  status: "COMPLETE";
  maximumLossBaseUnits: string;
  shortestPathTransitionIds: string[];
  blocked: Array<{ transitionId: string; policyCheckId: string }>;
  exploredStates: number;
  exploredTrajectories: number;
};

export type UnknownResult = {
  status: "UNKNOWN";
  unknownReason: "UNSUPPORTED_ACTION" | "MAX_DEPTH" | "MAX_STATES" | "MAX_BRANCHES" | "MAX_CONCURRENCY" | "TIMEOUT" | "PROVIDER_EVIDENCE_INVALID" | "SEARCH_INCOMPLETE";
  exploredStates: number;
  exploredTrajectories: number;
};

export type CheckResult = CompleteResult | UnknownResult;

type Clock = { now(): number };
const systemClock: Clock = { now: () => Date.now() };

function cloneState(state: SearchState): SearchState {
  return {
    balances: new Map(state.balances),
    cumulativeSpend: new Map(state.cumulativeSpend),
    approvals: new Map(state.approvals),
    consumedNonces: new Set(state.consumedNonces),
    loss: state.loss,
    path: [...state.path],
    blocked: [...state.blocked],
  };
}

function block(state: SearchState, transitionId: string, policyCheckId: string): void {
  state.blocked.push({ transitionId, policyCheckId });
}

function transferFields(action: Action): { assetId: string; amount: bigint; recipient: string; nonce?: string } | null {
  if (action.type === "transfer") return { assetId: action.assetId, amount: BigInt(action.amountBaseUnits), recipient: action.recipient, ...(action.nonce === undefined ? {} : { nonce: action.nonce }) };
  if (action.type === "callPaidTool") return { assetId: action.assetId, amount: BigInt(action.quotedMaxBaseUnits), recipient: action.recipient };
  return null;
}

function applyTransfer(state: SearchState, action: Action, policy: Policy, adversarialRecipients: ReadonlySet<string>, snapshot?: SearchState): boolean {
  const fields = transferFields(action);
  if (fields === null) return false;
  const checked = snapshot ?? state;
  if (!(policy.allowedRecipients[fields.assetId] ?? []).includes(fields.recipient)) { block(state, action.id, "recipient-not-allowed"); return false; }
  const perActionCap = policy.perActionCaps[fields.assetId];
  if (perActionCap === undefined || fields.amount > BigInt(perActionCap)) { block(state, action.id, "per-action-cap"); return false; }
  const cumulativeCap = policy.cumulativeCaps[fields.assetId];
  const priorSpend = checked.cumulativeSpend.get(fields.assetId) ?? 0n;
  if (cumulativeCap === undefined || priorSpend + fields.amount > BigInt(cumulativeCap)) { block(state, action.id, "cumulative-cap"); return false; }
  const balance = checked.balances.get(fields.assetId) ?? 0n;
  if (fields.amount > balance) { block(state, action.id, "insufficient-protected-balance"); return false; }
  if (fields.nonce !== undefined && policy.requireUniqueNonce && checked.consumedNonces.has(fields.nonce)) { block(state, action.id, "nonce-replayed"); return false; }

  state.balances.set(fields.assetId, (state.balances.get(fields.assetId) ?? 0n) - fields.amount);
  state.cumulativeSpend.set(fields.assetId, (state.cumulativeSpend.get(fields.assetId) ?? 0n) + fields.amount);
  if (fields.nonce !== undefined) state.consumedNonces.add(fields.nonce);
  if (adversarialRecipients.has(fields.recipient)) state.loss += fields.amount;
  state.path.push(action.id);
  return true;
}

function applySimple(state: SearchState, action: Action, policy: Policy, adversarialRecipients: ReadonlySet<string>): boolean {
  if (applyTransfer(state, action, policy, adversarialRecipients)) return true;
  if (action.type === "transfer" || action.type === "callPaidTool") return false;
  if (action.type === "approve") {
    const amount = BigInt(action.amountBaseUnits);
    const cap = policy.perActionCaps[action.assetId];
    if (!(policy.allowedRecipients[action.assetId] ?? []).includes(action.spender)) { block(state, action.id, "spender-not-allowed"); return false; }
    if (cap === undefined || amount > BigInt(cap)) { block(state, action.id, "approval-cap"); return false; }
    state.approvals.set(`${action.assetId}:${action.spender}`, amount);
    if (adversarialRecipients.has(action.spender)) state.loss += amount;
    state.path.push(action.id);
    return true;
  }
  if (action.type === "consumeBudget") {
    const amount = BigInt(action.amountBaseUnits);
    const cap = policy.cumulativeCaps[action.assetId];
    const prior = state.cumulativeSpend.get(action.assetId) ?? 0n;
    if (cap === undefined || prior + amount > BigInt(cap)) { block(state, action.id, "cumulative-cap"); return false; }
    state.cumulativeSpend.set(action.assetId, prior + amount);
    state.path.push(action.id);
    return true;
  }
  if (action.type === "advanceNonce") {
    if (policy.requireUniqueNonce && state.consumedNonces.has(action.scope)) { block(state, action.id, "nonce-replayed"); return false; }
    state.consumedNonces.add(action.scope);
    state.path.push(action.id);
    return true;
  }
  return false;
}

function compareComplete(left: CompleteResult | null, right: CompleteResult): CompleteResult {
  if (left === null) return right;
  const leftLoss = BigInt(left.maximumLossBaseUnits);
  const rightLoss = BigInt(right.maximumLossBaseUnits);
  if (rightLoss !== leftLoss) return rightLoss > leftLoss ? right : left;
  if (right.shortestPathTransitionIds.length !== left.shortestPathTransitionIds.length) return right.shortestPathTransitionIds.length < left.shortestPathTransitionIds.length ? right : left;
  return right.shortestPathTransitionIds.join("\u0000").localeCompare(left.shortestPathTransitionIds.join("\u0000")) < 0 ? right : left;
}

export function checkFixture(compiled: CompiledModel, fixtureInput: unknown, clock: Clock = systemClock): CheckResult {
  const fixture = FixtureSchema.parse(fixtureInput) as Fixture;
  if (fixture.candidateTrajectories.length > compiled.limits.maxBranches) return { status: "UNKNOWN", unknownReason: "MAX_BRANCHES", exploredStates: 0, exploredTrajectories: 0 };
  const start = clock.now();
  let exploredStates = 0;
  let exploredTrajectories = 0;
  let best: CompleteResult | null = null;
  const allBlocked = new Map<string, { transitionId: string; policyCheckId: string }>();
  const adversarial = new Set(fixture.adversarialRecipients);

  for (const trajectory of fixture.candidateTrajectories) {
    exploredTrajectories += 1;
    const state: SearchState = {
      balances: new Map(Object.entries(compiled.policy.protectedBalances).map(([asset, amount]) => [asset, BigInt(amount)])),
      cumulativeSpend: new Map(), approvals: new Map(), consumedNonces: new Set(), loss: 0n, path: [], blocked: [],
    };

    for (const actionId of trajectory) {
      if (clock.now() - start >= compiled.limits.timeoutMs) return { status: "UNKNOWN", unknownReason: "TIMEOUT", exploredStates, exploredTrajectories };
      const action = compiled.actions.get(actionId);
      if (action === undefined) return { status: "UNKNOWN", unknownReason: "PROVIDER_EVIDENCE_INVALID", exploredStates, exploredTrajectories };

      if (action.type === "spawn") {
        if (action.concurrencyLimit > compiled.limits.maxConcurrency) return { status: "UNKNOWN", unknownReason: "MAX_CONCURRENCY", exploredStates, exploredTrajectories };
        if (action.concurrencyLimit > compiled.policy.maxConcurrency) { block(state, action.id, "concurrency-limit"); break; }
        const snapshot = cloneState(state);
        const children = action.childActionIds.map((id) => compiled.actions.get(id));
        if (children.some((child) => child === undefined)) return { status: "UNKNOWN", unknownReason: "PROVIDER_EVIDENCE_INVALID", exploredStates, exploredTrajectories };
        let allowed = true;
        for (const child of children as Action[]) if (!applyTransfer(state, child, compiled.policy, adversarial, snapshot)) { allowed = false; break; }
        exploredStates += children.length;
        if (!allowed) break;
      } else if (action.type === "recurse") {
        if (compiled.policy.maxRecursionDepth === 0) { block(state, action.id, "recursion-limit"); break; }
        for (let depth = 1; depth <= action.depthLimit; depth += 1) {
          if (depth > compiled.policy.maxRecursionDepth) { block(state, action.id, "recursion-limit"); break; }
          for (const bodyId of action.bodyActionIds) {
            const body = compiled.actions.get(bodyId);
            if (body === undefined) return { status: "UNKNOWN", unknownReason: "PROVIDER_EVIDENCE_INVALID", exploredStates, exploredTrajectories };
            applySimple(state, body, compiled.policy, adversarial);
            exploredStates += 1;
          }
        }
      } else {
        applySimple(state, action, compiled.policy, adversarial);
        exploredStates += 1;
      }

      if (state.path.length > compiled.limits.maxDepth) return { status: "UNKNOWN", unknownReason: "MAX_DEPTH", exploredStates, exploredTrajectories };
      if (exploredStates > compiled.limits.maxStates) return { status: "UNKNOWN", unknownReason: "MAX_STATES", exploredStates, exploredTrajectories };
      if (state.blocked.length > 0) break;
    }

    for (const item of state.blocked) allBlocked.set(`${item.transitionId}:${item.policyCheckId}`, item);
    best = compareComplete(best, {
      status: "COMPLETE",
      maximumLossBaseUnits: state.loss.toString(),
      shortestPathTransitionIds: state.path,
      blocked: [],
      exploredStates,
      exploredTrajectories,
    });
  }

  if (best === null) return { status: "UNKNOWN", unknownReason: "SEARCH_INCOMPLETE", exploredStates, exploredTrajectories };
  return { ...best, blocked: [...allBlocked.values()].sort((a, b) => a.transitionId.localeCompare(b.transitionId) || a.policyCheckId.localeCompare(b.policyCheckId)), exploredStates, exploredTrajectories };
}
