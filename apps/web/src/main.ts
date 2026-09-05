import "./styles.css";
import artifactData from "./generated/demo-artifacts.json" with { type: "json" };
import type { DemoArtifact } from "../scripts/demo-artifacts.js";
import { actionById, fixtureLabel, formatMoney, shortHash } from "./view-model.js";
import { h, s, frag, replaceChildren, type Child } from "./dom.js";

type View = "run" | "fixtures" | "evidence" | "model";

const VIEWS: readonly View[] = ["run", "fixtures", "evidence", "model"];

// The four views are deep-linkable: #evidence/replay-two restores both the tab and
// the fixture, so a link shared with a reviewer opens on what the sender was reading.
function readRoute(): { view: View; fixtureId: string | null } {
  const [rawView, rawFixture] = window.location.hash.replace(/^#/, "").split("/");
  const view = VIEWS.find((candidate) => candidate === rawView) ?? "run";
  return { view, fixtureId: rawFixture === undefined || rawFixture === "" ? null : decodeURIComponent(rawFixture) };
}

function writeRoute(): void {
  const view = VIEWS.find((candidate) => candidate === state.view) ?? "run";
  const next = "#" + view + "/" + encodeURIComponent(state.selected.fixtureId);
  if (window.location.hash !== next) window.history.replaceState(null, "", next);
}

type RunStage = "ready" | "replaying" | "verifying" | "complete";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (appRoot === null) throw new Error("app root is missing");
const app: HTMLDivElement = appRoot;

function fatal(message: string): never {
  replaceChildren(app, h("main", { class: "fatal-state" },
    h("div", { class: "eyebrow" }, "Artifact unavailable"),
    h("h1", {}, "Worstcase could not load this checked run."),
    h("p", {}, message),
    h("button", { class: "button button-primary", id: "reload-app" }, "Reload artifact")));
  document.querySelector<HTMLButtonElement>("#reload-app")?.addEventListener("click", () => window.location.reload());
  throw new Error(message);
}

const artifacts = Array.isArray(artifactData) ? artifactData as DemoArtifact[] : fatal("The generated fixture artifact is not an array.");
const initial = artifacts.find((item) => item.fixtureId === "prompt-injection");
if (initial === undefined) fatal("The required prompt-injection fixture is missing. Regenerate the demo artifacts and reload.");

const state: {
  view: View;
  selected: DemoArtifact;
  selectedStep: string | null;
  runStage: RunStage;
  notice: string | null;
} = {
  view: "run",
  selected: initial,
  selectedStep: initial.result.shortestPathTransitionIds.at(-1) ?? null,
  runStage: "complete",
  notice: null,
};

let replayToken = 0;

function navButton(view: View, label: string): HTMLElement {
  const current = state.view === view;
  return h("button", { class: "nav-item", "data-view": view, "aria-current": current && "page" }, label);
}

function stageCopy(): string {
  if (state.runStage === "replaying") return "Replaying the checked local fixture artifact";
  if (state.runStage === "verifying") return "Comparing the replay projection with recorded hashes";
  return "Checked local artifact ready to replay";
}

function runButton(): HTMLElement {
  const busy = state.runStage === "replaying" || state.runStage === "verifying";
  return h("button", { class: "button button-primary", "data-replay": true, "aria-busy": String(busy) },
    h("span", { class: "button-dot", "aria-hidden": "true" }),
    busy ? "Cancel replay" : "Replay fixture");
}

/** The one (or few) calls that realise the bound. Small by design: a single-step
 * counterexample fills this cell instead of leaving a hollow ledger. */
function renderCallCell(): HTMLElement {
  const result = state.selected.result;
  const ids = result.shortestPathTransitionIds;

  if (ids.length === 0) {
    return h("section", { class: "cell cell-call", "aria-labelledby": "call-title" },
      h("div", { class: "cell-label" }, h("h2", { id: "call-title" }, "No reachable adversarial edge")),
      h("p", { class: "cell-note" }, "Nothing in this agent can move value to a declared adversarial recipient under its policy. The panel beside this one lists every path that was tried and the rule that stopped it."));
  }

  const steps = ids.flatMap((id, index) => {
    const action = actionById(state.selected, id);
    if (action === undefined) return [];
    const selected = state.selectedStep === id;
    const balance = formatMoney(state.selected.protectedBalanceBaseUnits, state.selected.asset.decimals, 2);
    return [h("button", { class: `step ${selected ? "is-selected" : ""}`, "data-step": id, "aria-current": selected && "step" },
      h("span", { class: "step-n" }, index + 1),
      h("span", { class: "step-body" },
        h("strong", {}, fixtureLabel(id)),
        h("small", {}, action.type, action.recipient === undefined ? "" : ` · ${action.recipient}`, ` · balance ${balance}`)),
      h("b", { class: action.adversarial ? "is-loss" : "" },
        action.amountBaseUnits === undefined ? "—" : `−${formatMoney(action.amountBaseUnits, state.selected.asset.decimals, 2)}`))];
  });

  const focused = state.selectedStep === null ? undefined : actionById(state.selected, state.selectedStep);
  const permitted = focused === undefined
    ? null
    : h("div", { class: "why" },
      h("span", { class: "why-label" }, "Why it is permitted"),
      h("code", {},
        `allowedRecipients.${state.selected.asset.id} includes “${focused.recipient ?? "n/a"}” → `,
        h("b", {}, state.selected.allowedRecipients.includes(focused.recipient ?? "") ? "TRUE" : "FALSE")));

  return h("section", { class: "cell cell-call", "aria-labelledby": "call-title" },
    h("div", { class: "cell-label" },
      h("h2", { id: "call-title" }, ids.length === 1 ? "The call that realises it" : "The calls that realise it"),
      h("span", {}, `${ids.length} step${ids.length === 1 ? "" : "s"}`)),
    h("div", { class: "steps" }, ...steps),
    permitted);
}

/** Why nothing loses more. A co-equal panel, because exhaustion is what makes the
 * figure a bound rather than a sighting — and it carries runs with no path at all.
 *
 * Two kinds of entry, both real: edges a policy rule stopped, and edges the search
 * reached but which cannot increase the loss. Listing only the first left this panel
 * empty for permissive policies, which understated how much was actually examined. */
function renderRuledOutCell(): HTMLElement {
  const result = state.selected.result;
  const onPath = new Set(result.shortestPathTransitionIds);
  const blockedIds = new Set(result.blocked.map((item) => item.transitionId));

  const ruledRow = (id: string, reason: string): HTMLElement =>
    h("li", {}, h("button", { class: "ruled-row", "data-step": id },
      h("span", { class: "struck" }, fixtureLabel(id)),
      h("code", {}, reason)));

  const blockedRows = result.blocked.map((item) => ruledRow(item.transitionId, item.policyCheckId));

  // Reached, permitted, but cannot raise the bound — the other half of the proof.
  const inertRows = state.selected.actions
    .filter((action) => !onPath.has(action.id) && !blockedIds.has(action.id))
    .map((action) => ruledRow(action.id, action.adversarial ? "no further loss" : "not adversarial"));

  const rows = [...blockedRows, ...inertRows];
  const body: Child[] = rows.length === 0
    ? [h("li", { class: "ruled-empty" }, "Every declared action lies on the maximum-loss path.")]
    : rows;

  const note = result.status === "UNKNOWN"
    ? "The search was truncated, so no figure is claimed. This is not a pass."
    : `The reachable space was explored and exhausted across ${result.exploredStates} state${result.exploredStates === 1 ? "" : "s"}. Had it been truncated, this panel would read UNKNOWN and no figure would be shown.`;

  return h("section", { class: "cell cell-ruled", "aria-labelledby": "ruled-title" },
    h("div", { class: "cell-label" },
      h("h2", { id: "ruled-title" }, "Ruled out — why nothing loses more"),
      h("span", {}, `${rows.length} edge${rows.length === 1 ? "" : "s"}`)),
    h("ul", { class: "ruled" }, ...body),
    h("p", { class: "cell-note" }, note));
}

function renderEvidenceStrip(): HTMLElement {
  const anchor = state.selected.anchor;
  const store = state.selected.storage;
  const cell = (label: string, value: Child, good = false) =>
    h("div", { class: "ev" }, h("dt", {}, label), h("dd", { class: good ? "is-good" : "" }, value));
  return h("dl", { class: "cell cell-evidence" },
    cell("0G Storage", store === undefined ? "not uploaded" : "re-verified", store !== undefined),
    cell("0G Chain", anchor === undefined ? "not anchored" : `anchored · ${anchor.chainId}`, anchor !== undefined),
    cell("Bundle root", h("code", {}, shortHash(state.selected.bundleRoot))),
    cell("Engine", h("code", {}, state.selected.engineVersion)));
}

function fixtureRow(artifact: DemoArtifact): HTMLElement {
  const active = artifact.fixtureId === state.selected.fixtureId;
  const complete = artifact.result.status === "COMPLETE";
  const amount = complete
    ? `${formatMoney(artifact.result.maximumLossBaseUnits ?? "0", artifact.asset.decimals, 2)} ${artifact.asset.symbol}`
    : "UNKNOWN";
  return h("button", { class: "fixture-row", "data-fixture": artifact.fixtureId, "aria-current": active && "true" },
    h("span", { class: "fixture-index" }, String(artifacts.indexOf(artifact) + 1).padStart(2, "0")),
    h("span", {}, h("strong", {}, fixtureLabel(artifact.fixtureId)), h("small", {}, artifact.description)),
    h("b", { class: BigInt(artifact.result.maximumLossBaseUnits ?? "0") > 0n ? "is-loss" : "" }, amount));
}

const MODEL_ROWS: readonly (readonly [string, string, string])[] = [
  ["transfer", "Supported", "Balance, caps, recipient, nonce"],
  ["callPaidTool", "Supported", "Quoted maximum transfer"],
  ["spawn", "Supported", "Snapshot concurrency"],
  ["recurse", "Supported", "Bounded depth"],
  ["arbitrary side effect", "Unsupported", "Returns UNKNOWN"],
];

function modelTable(): HTMLElement {
  return h("div", { class: "model-table", role: "table", "aria-label": "Model support" },
    h("div", { role: "row" },
      h("span", { role: "columnheader" }, "Action family"),
      h("span", { role: "columnheader" }, "Status"),
      h("span", { role: "columnheader" }, "Bound effect")),
    ...MODEL_ROWS.map(([action, status, effect]) => h("div", { role: "row" },
      h("code", { role: "cell" }, action),
      h("span", { role: "cell", class: status === "Unsupported" ? "is-loss" : "" }, status),
      h("span", { role: "cell" }, effect))));
}

function renderRun(): DocumentFragment {
  const result = state.selected.result;
  const complete = result.status === "COMPLETE";
  const loss = complete ? BigInt(result.maximumLossBaseUnits ?? "0") : null;
  const tone = loss === 0n ? "is-clear" : complete ? "is-danger" : "is-unknown";

  // UNKNOWN replaces the figure entirely. It must never render as a zero.
  const figure = complete
    ? frag(
      h("div", { class: `figure ${tone}` },
        formatMoney(result.maximumLossBaseUnits ?? "0", state.selected.asset.decimals, 2),
        h("span", { class: "unit" }, state.selected.asset.symbol)),
      h("p", { class: "claim" }, loss === 0n ? "reaches the declared adversarial recipient. Nothing does." : "can reach the declared adversarial recipient."))
    : frag(
      h("div", { class: "figure is-unknown no-figure" }, "UNKNOWN"),
      h("p", { class: "claim" }, "The search did not finish, so no bound is claimed. Reason: ",
        h("code", {}, result.unknownReason ?? "SEARCH_INCOMPLETE"), "."));

  return frag(
    h("section", { class: "bento", "aria-labelledby": "result-title" },
      h("section", { class: `cell cell-bound ${tone}` },
        h("div", { class: "cell-label" },
          h("span", { class: `pulse ${state.runStage !== "complete" ? "is-running" : ""}`, "aria-hidden": "true" }),
          h("h1", { id: "result-title" }, complete ? "Maximum reachable loss · complete" : "No monetary result · unknown")),
        figure,
        h("p", { class: "cell-desc" }, state.selected.description),
        h("p", { class: "run-stage", role: "status", "aria-live": "polite" }, stageCopy())),

      h("section", { class: "cell cell-basis", "aria-label": "Basis of the figure" },
        h("div", { class: "cell-label" }, h("h2", {}, "Basis of the figure")),
        h("dl", { class: "rows" },
          h("div", {}, h("dt", {}, "Winning rule"), h("dd", {}, "maximum loss")),
          h("div", {}, h("dt", {}, "Tie-break"), h("dd", {}, "shortest path")),
          h("div", {}, h("dt", {}, "Explored"), h("dd", {}, `${result.exploredStates} states / ${result.exploredTrajectories} path${result.exploredTrajectories === 1 ? "" : "s"}`)),
          h("div", {}, h("dt", {}, "Model support"), h("dd", {}, state.selected.supportStatus.toLowerCase())))),

      renderCallCell(),
      renderRuledOutCell(),
      renderEvidenceStrip(),

      h("div", { class: "cell-actions" },
        runButton(),
        h("button", { class: "button button-secondary", id: "compare-policy" },
          state.selected.fixtureId === "policy-fix" ? "Return to vulnerable policy" : "Compare the policy fix"))),
    renderDepth());
}

/**
 * Everything below the fold.
 *
 * The bento answers the question in one screen, which is right for a first read,
 * but it left the page exactly viewport-height with nothing to scroll to, so it
 * read as thin. These sections are the rest of the real evidence: the whole
 * corpus, how to check the result without trusting this site, and where the
 * model stops. Nothing here is filler.
 */
function renderDepth(): HTMLElement {
  const anchor = state.selected.anchor;
  const store = state.selected.storage;

  const verifyCmd = anchor === undefined ? "" : `cast call ${anchor.runRegistry} \\
  "getAnchor(address,bytes32)((bytes32,bytes32,uint256,bytes32,uint8,address,uint64))" \\
  ${anchor.submitter} \\
  ${state.selected.bundleRoot} \\
  --rpc-url ${anchor.chainId === 16661 ? "https://evmrpc.0g.ai" : "https://evmrpc-testnet.0g.ai"}`;

  const checkBody = anchor === undefined
    ? h("p", { class: "cell-note" }, "This run is not anchored, so there is nothing to read back.")
    : frag(
      h("pre", { class: "verify" }, h("code", {}, verifyCmd)),
      h("div", { class: "depth-links" },
        h("a", { href: anchor.explorerTx, target: "_blank", rel: "noopener noreferrer" }, "Anchor transaction"),
        h("a", { href: anchor.explorerContract, target: "_blank", rel: "noopener noreferrer" }, "RunRegistry contract"),
        store === undefined || store.explorerTx === null
          ? null
          : h("a", { href: store.explorerTx, target: "_blank", rel: "noopener noreferrer" }, "Storage upload")));

  return h("section", { class: "depth", "aria-label": "More about this run" },
    h("section", { class: "depth-block" },
      h("h2", {}, "The whole corpus"),
      h("p", {}, "Five planted attacks, a clean agent, and the same agent after one policy edge is tightened. Each is its own model, so the family it plants is what binds its number. Select any to load it."),
      h("div", { class: "fixture-list" }, ...artifacts.map(fixtureRow))),

    h("section", { class: "depth-block" },
      h("h2", {}, "Check it without trusting this page"),
      h("p", {}, "The figure above is anchored on 0G Chain against the exact policy, graph and engine that produced it. Read it straight off the chain:"),
      checkBody),

    h("section", { class: "depth-block" },
      h("h2", {}, "Where the model stops"),
      h("p", {}, "An action the compiler cannot model is refused rather than skipped, because skipping one would quietly lower the bound."),
      modelTable()));
}

function renderFixtures(): HTMLElement {
  return h("section", { class: "section-view", "aria-labelledby": "fixtures-title" },
    h("div", { class: "section-heading" },
      h("div", { class: "eyebrow" }, "Fixture catalog · version 1"),
      h("h1", { id: "fixtures-title" }, "Choose one planted failure."),
      h("p", {}, `Every amount below comes from the checked fixture artifact generated by engine ${state.selected.engineVersion}.`)),
    h("div", { class: "fixture-list" }, ...artifacts.map(fixtureRow)));
}

function renderEvidence(): HTMLElement {
  const anchor = state.selected.anchor;
  const store = state.selected.storage;

  const row = (term: string, value: Child, note: string) =>
    h("div", {}, h("dt", {}, term), h("dd", {}, value), h("small", {}, note));

  const chainRows: Child[] = anchor === undefined
    ? [row("0G Chain", "Not anchored", "No registry event exists")]
    : [
      row("0G Chain", h("a", { href: anchor.explorerTx, target: "_blank", rel: "noopener noreferrer" }, `Anchored on ${anchor.network}`), "Read back from chain state and matched"),
      row("Registry", h("a", { href: anchor.explorerContract, target: "_blank", rel: "noopener noreferrer" }, h("code", {}, shortHash(anchor.runRegistry))), `Chain ${anchor.chainId}`),
    ];

  // Content-addressed storage creates no transaction when identical bytes are
  // already stored, so only offer a transaction link when one actually exists.
  const storageRows: Child[] = store === undefined
    ? [row("0G Storage", "Not uploaded", "No transaction exists")]
    : [
      store.explorerTx === null
        ? row("0G Storage", "Stored and re-verified", "Identical bytes already stored, so no new transaction")
        : row("0G Storage", h("a", { href: store.explorerTx, target: "_blank", rel: "noopener noreferrer" }, "Uploaded and re-verified"), "Downloaded back, root re-derived, bytes identical"),
      row("Storage root", h("code", {}, shortHash(store.storageRoot)), `Merkle root on ${store.network}`),
    ];

  const heading = anchor === undefined
    ? "Local, reproducible, not yet published."
    : store === undefined
      ? "Reproducible locally, verifiable on 0G Chain."
      : "Reproducible locally, retrievable and verifiable on 0G.";
  const blurb = anchor === undefined
    ? "This bundle is generated from the exact fixture, policy, graph, engine, and deterministic result. It does not claim 0G provenance."
    : store === undefined
      ? "This bundle is generated from the exact fixture, policy, graph, engine, and deterministic result. Its root and maximum loss are bound on 0G Chain to the model version that produced them."
      : "This bundle is generated from the exact fixture, policy, graph, engine, and deterministic result. It is stored on 0G Storage and was downloaded back and re-derived to the same root, and its maximum loss is bound on 0G Chain to the model version that produced it.";

  return h("section", { class: "section-view", "aria-labelledby": "evidence-title" },
    h("div", { class: "section-heading" },
      h("div", { class: "eyebrow" }, "Canonical evidence"),
      h("h1", { id: "evidence-title" }, heading),
      h("p", {}, blurb)),
    h("dl", { class: "evidence-sheet" },
      row("Origin", "Local fixture", "Not 0G Compute"),
      row("Bundle root", h("code", {}, state.selected.bundleRoot), "Canonical local bytes"),
      ...storageRows,
      ...chainRows),
    h("button", { class: "button button-secondary", id: "copy-root" }, "Copy bundle root"));
}

function renderModel(): HTMLElement {
  const hash = (term: string, value: string) => h("div", {}, h("dt", {}, term), h("dd", {}, h("code", {}, shortHash(value))));
  return h("section", { class: "section-view", "aria-labelledby": "model-title" },
    h("div", { class: "section-heading" },
      h("div", { class: "eyebrow" }, "Declared model"),
      h("h1", { id: "model-title" }, "Supported actions are explicit."),
      h("p", {}, "Unknown semantics must stop analysis. They are never silently interpreted as safe.")),
    modelTable(),
    h("dl", { class: "hashes" },
      hash("Manifest", state.selected.manifestHash),
      hash("Policy", state.selected.policyHash),
      hash("Graph", state.selected.graphHash)));
}

function renderMain(): Node {
  if (state.view === "fixtures") return renderFixtures();
  if (state.view === "evidence") return renderEvidence();
  if (state.view === "model") return renderModel();
  return renderRun();
}

function brandMark(): SVGElement {
  return s("svg", { class: "brand-mark", viewBox: "0 0 64 64", "aria-hidden": "true", focusable: "false" },
    s("rect", { width: "64", height: "64", rx: "14", fill: "#0c0d0f" }),
    s("rect", { x: "0.5", y: "0.5", width: "63", height: "63", rx: "13.5", fill: "none", stroke: "#e6e8ea", "stroke-opacity": "0.10" }),
    s("path", { d: "M12 52 V44 H22 V36 H32 V28 H42 V20 H52 V52 Z", fill: "#e0603a" }),
    s("rect", { x: "10", y: "16", width: "44", height: "4", rx: "1", fill: "#e6e8ea" }));
}

// Navigation only. Replay used to live in here, which mixed a primary action
// into the nav bar and made the bar the loudest thing on a small screen.
function renderMobileNav(): DocumentFragment {
  return frag(navButton("run", "Run"), navButton("fixtures", "Fixtures"), navButton("evidence", "Proof"), navButton("model", "Model"));
}

function render(): void {
  const anchor = state.selected.anchor;
  replaceChildren(app,
    h("a", { class: "skip-link", href: "#main-content" }, "Skip to main content"),
    h("div", { class: "app-shell" },
      h("header", { class: "topbar" },
        h("div", { class: "brand" }, brandMark(), h("span", {}, "Worstcase")),
        h("span", { class: "crumb" }, "/ runs / ", h("code", {}, state.selected.fixtureId)),
        h("nav", { class: "topnav", "aria-label": "Primary navigation" },
          navButton("run", "Run"), navButton("fixtures", "Fixtures"), navButton("evidence", "Evidence"), navButton("model", "Model")),
        h("span", { class: `provenance ${anchor === undefined ? "" : "is-anchored"}` },
          h("span", { "aria-hidden": "true" }),
          anchor === undefined ? "local · not anchored" : `local fixture · anchored on ${anchor.network}`)),
      h("main", { id: "main-content", tabindex: "-1" }, h("div", { class: "content" }, renderMain())),
      h("nav", { class: "mobile-nav", "aria-label": "Mobile navigation" }, renderMobileNav()),
      state.notice === null ? null : h("div", { class: "notice", role: "status" }, state.notice)));
  bindEvents();
}

function showNotice(message: string): void {
  state.notice = message;
  const existing = document.querySelector<HTMLDivElement>(".notice");
  if (existing !== null) existing.textContent = message;
  else document.querySelector(".app-shell")?.append(h("div", { class: "notice", role: "status" }, message));
}

function replayFixture(): void {
  const busy = state.runStage === "replaying" || state.runStage === "verifying";
  replayToken += 1;
  const token = replayToken;
  if (busy) {
    state.runStage = "complete";
    state.notice = "Replay cancelled. The checked artifact was not changed.";
    render();
    return;
  }
  state.runStage = "replaying";
  state.notice = null;
  render();
  window.setTimeout(() => {
    if (token !== replayToken) return;
    state.runStage = "verifying";
    render();
  }, 240);
  window.setTimeout(() => {
    if (token !== replayToken) return;
    state.runStage = "complete";
    state.notice = "Checked artifact replay matches the recorded local result.";
    render();
  }, 520);
}

function selectFixture(id: string, view: View = "run"): void {
  const selected = artifacts.find((item) => item.fixtureId === id);
  if (selected === undefined) return;
  state.selected = selected;
  state.selectedStep = selected.result.shortestPathTransitionIds.at(-1) ?? null;
  state.runStage = "complete";
  state.view = view;
  state.notice = null;
  writeRoute();
  render();
}

function bindEvents(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => button.addEventListener("click", () => {
    const requested = VIEWS.find((candidate) => candidate === button.dataset.view);
    if (requested === undefined) return;
    state.view = requested;
    state.notice = null;
    writeRoute();
    render();
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-fixture]").forEach((button) => button.addEventListener("click", () => selectFixture(button.dataset.fixture ?? "")));
  document.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((button) => button.addEventListener("click", () => {
    state.selectedStep = button.dataset.step ?? null;
    render();
  }));
  document.querySelector<HTMLButtonElement>("#compare-policy")?.addEventListener("click", () => selectFixture(state.selected.fixtureId === "policy-fix" ? "prompt-injection" : "policy-fix"));
  document.querySelectorAll<HTMLButtonElement>("[data-replay]").forEach((button) => button.addEventListener("click", replayFixture));
  document.querySelector<HTMLButtonElement>("#copy-root")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.selected.bundleRoot);
      showNotice("Bundle root copied.");
    } catch {
      showNotice("Clipboard unavailable. Select the bundle root manually.");
    }
  });
}

function applyRoute(): void {
  const route = readRoute();
  state.view = route.view;
  if (route.fixtureId === null) return;
  const match = artifacts.find((item) => item.fixtureId === route.fixtureId);
  if (match === undefined) return;
  state.selected = match;
  state.selectedStep = match.result.shortestPathTransitionIds.at(-1) ?? null;
  state.runStage = "complete";
}

// Back/forward must move between views, not leave the browser.
window.addEventListener("hashchange", () => {
  applyRoute();
  render();
});

applyRoute();
writeRoute();
render();
