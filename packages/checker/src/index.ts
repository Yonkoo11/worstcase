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
  /**
   * Top-level actions already committed on this path.
   *
   * A manifest action is one concrete intent, not a tool that may be invoked
   * without limit: `replay-one` and `replay-two` exist as separate entries
   * precisely because each is a single submission, and `parallel-a`/`parallel-b`
   * are identical twins for the same reason. Repetition that is genuinely part
   * of the model is expressed by `recurse` and `spawn`, which do their own
   * repeating inside a single step.
   */
  used: Set<string>;
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
    used: new Set(state.used),
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
  // Policy counters above are checked against `checked`, which for a spawned
  // child is the pre-spawn snapshot. That is the real race: two parallel calls
  // both read a stale budget and both pass.
  //
  // Settlement is different. Funds are checked against the live state even
  // inside a spawn, because a racing counter cannot conjure balance that is
  // already gone. Without this the search reports losses larger than the
  // protected balance, which is not a reachable outcome.
  const balance = state.balances.get(fields.assetId) ?? 0n;
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

/**
 * Canonical identity of an economic state.
 *
 * Deliberately excludes `path` and `blocked`, which are bookkeeping rather than
 * state. Two orderings of the same spends reach the same economic position, so
 * collapsing them is what keeps the reachable set small enough to enumerate.
 */
function stateKey(state: SearchState): string {
  const pairs = (map: Map<string, bigint>) =>
    [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}=${v}`).join(",");
  return [
    pairs(state.balances),
    pairs(state.cumulativeSpend),
    pairs(state.approvals),
    [...state.consumedNonces].sort().join(","),
    [...state.used].sort().join(","),
    state.loss.toString(),
  ].join("|");
}

type StepOutcome =
  | { kind: "ok"; next: SearchState }
  | { kind: "blocked"; next: SearchState }
  | { kind: "unknown"; reason: UnknownResult["unknownReason"] };

/** Apply one action to a copy of `state`, preserving the original semantics. */
function stepAction(state: SearchState, action: Action, compiled: CompiledModel, adversarial: ReadonlySet<string>): StepOutcome {
  const next = cloneState(state);

  if (action.type === "spawn") {
    if (action.concurrencyLimit > compiled.limits.maxConcurrency) return { kind: "unknown", reason: "MAX_CONCURRENCY" };
    if (action.concurrencyLimit > compiled.policy.maxConcurrency) { block(next, action.id, "concurrency-limit"); return { kind: "blocked", next }; }
    const snapshot = cloneState(next);
    const children = action.childActionIds.map((id) => compiled.actions.get(id));
    if (children.some((child) => child === undefined)) return { kind: "unknown", reason: "PROVIDER_EVIDENCE_INVALID" };
    for (const child of children as Action[]) {
      if (!applyTransfer(next, child, compiled.policy, adversarial, snapshot)) return { kind: "blocked", next };
    }
    return { kind: "ok", next };
  }

  if (action.type === "recurse") {
    if (compiled.policy.maxRecursionDepth === 0) { block(next, action.id, "recursion-limit"); return { kind: "blocked", next }; }
    for (let depth = 1; depth <= action.depthLimit; depth += 1) {
      if (depth > compiled.policy.maxRecursionDepth) { block(next, action.id, "recursion-limit"); return { kind: "blocked", next }; }
      for (const bodyId of action.bodyActionIds) {
        const body = compiled.actions.get(bodyId);
        if (body === undefined) return { kind: "unknown", reason: "PROVIDER_EVIDENCE_INVALID" };
        if (!applySimple(next, body, compiled.policy, adversarial)) return { kind: "blocked", next };
      }
    }
    return { kind: "ok", next };
  }

  if (!applySimple(next, action, compiled.policy, adversarial)) return { kind: "blocked", next };
  return { kind: "ok", next };
}

/**
 * Enumerate the reachable economic states and return the greatest loss any of
 * them realises, with the shortest path that reaches it.
 *
 * Breadth-first, so the first path found to a given state is a shortest one.
 * If the search is truncated for any reason the result is UNKNOWN rather than
 * the best value found so far: a partial maximum would understate the bound,
 * and understating it is the one failure this tool must not commit.
 */
export function searchMaximumLoss(
  compiled: CompiledModel,
  adversarialRecipients: Iterable<string>,
  clock: Clock = systemClock,
): CheckResult {
  const adversarial = new Set(adversarialRecipients);
  const start = clock.now();
  const actionIds = [...compiled.actions.keys()].sort((a, b) => a.localeCompare(b));

  const initial: SearchState = {
    balances: new Map(Object.entries(compiled.policy.protectedBalances).map(([asset, amount]) => [asset, BigInt(amount)])),
    cumulativeSpend: new Map(), approvals: new Map(), consumedNonces: new Set(), loss: 0n, path: [], blocked: [], used: new Set(),
  };

  const allBlocked = new Map<string, { transitionId: string; policyCheckId: string }>();
  const seen = new Set<string>([stateKey(initial)]);
  let frontier: SearchState[] = [initial];
  let exploredStates = 1;
  let edges = 0;
  let best: CompleteResult | null = { status: "COMPLETE", maximumLossBaseUnits: "0", shortestPathTransitionIds: [], blocked: [], exploredStates: 1, exploredTrajectories: 0 };

  for (let depth = 0; depth < compiled.limits.maxDepth && frontier.length > 0; depth += 1) {
    const nextFrontier: SearchState[] = [];
    for (const state of frontier) {
      for (const actionId of actionIds) {
        if (clock.now() - start >= compiled.limits.timeoutMs) return { status: "UNKNOWN", unknownReason: "TIMEOUT", exploredStates, exploredTrajectories: edges };
        if (state.used.has(actionId)) continue;
        const action = compiled.actions.get(actionId);
        if (action === undefined) return { status: "UNKNOWN", unknownReason: "PROVIDER_EVIDENCE_INVALID", exploredStates, exploredTrajectories: edges };

        const outcome = stepAction(state, action, compiled, adversarial);
        if (outcome.kind === "ok") outcome.next.used.add(actionId);
        if (outcome.kind === "unknown") return { status: "UNKNOWN", unknownReason: outcome.reason, exploredStates, exploredTrajectories: edges };
        if (outcome.kind === "blocked") {
          for (const item of outcome.next.blocked) allBlocked.set(`${item.transitionId}:${item.policyCheckId}`, item);
          continue;
        }

        edges += 1;
        const key = stateKey(outcome.next);
        if (seen.has(key)) continue;
        seen.add(key);
        exploredStates += 1;
        if (exploredStates > compiled.limits.maxStates) return { status: "UNKNOWN", unknownReason: "MAX_STATES", exploredStates, exploredTrajectories: edges };

        best = compareComplete(best, {
          status: "COMPLETE",
          maximumLossBaseUnits: outcome.next.loss.toString(),
          shortestPathTransitionIds: outcome.next.path,
          blocked: [],
          exploredStates,
          exploredTrajectories: edges,
        });
        nextFrontier.push(outcome.next);
      }
    }
    frontier = nextFrontier;
  }

  // Anything still queued at the depth ceiling means the space was not exhausted.
  if (frontier.length > 0) return { status: "UNKNOWN", unknownReason: "MAX_DEPTH", exploredStates, exploredTrajectories: edges };
  if (best === null) return { status: "UNKNOWN", unknownReason: "SEARCH_INCOMPLETE", exploredStates, exploredTrajectories: edges };

  return {
    ...best,
    blocked: [...allBlocked.values()].sort((a, b) => a.transitionId.localeCompare(b.transitionId) || a.policyCheckId.localeCompare(b.policyCheckId)),
    exploredStates,
    exploredTrajectories: edges,
  };
}

function compareComplete(left: CompleteResult | null, right: CompleteResult): CompleteResult {
  if (left === null) return right;
  const leftLoss = BigInt(left.maximumLossBaseUnits);
  const rightLoss = BigInt(right.maximumLossBaseUnits);
  if (rightLoss !== leftLoss) return rightLoss > leftLoss ? right : left;
  if (right.shortestPathTransitionIds.length !== left.shortestPathTransitionIds.length) return right.shortestPathTransitionIds.length < left.shortestPathTransitionIds.length ? right : left;
  return right.shortestPathTransitionIds.join("\u0000").localeCompare(left.shortestPathTransitionIds.join("\u0000")) < 0 ? right : left;
}

/**
 * Check a fixture by searching its model, not by replaying its declared paths.
 *
 * `candidateTrajectories` remains part of the fixture format as the planted
 * attack the fixture is documenting, but it is no longer the search input. The
 * bound now comes from the reachable state space, so it cannot be lowered by
 * simply forgetting to write a trajectory down.
 */
export function checkFixture(compiled: CompiledModel, fixtureInput: unknown, clock: Clock = systemClock): CheckResult {
  const fixture = FixtureSchema.parse(fixtureInput) as Fixture;
  if (fixture.candidateTrajectories.length > compiled.limits.maxBranches) return { status: "UNKNOWN", unknownReason: "MAX_BRANCHES", exploredStates: 0, exploredTrajectories: 0 };
  return searchMaximumLoss(compiled, fixture.adversarialRecipients, clock);
}
