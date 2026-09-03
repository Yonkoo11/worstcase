import "./styles.css";
import artifactData from "./generated/demo-artifacts.json" with { type: "json" };
import type { DemoArtifact, DemoAction } from "../scripts/demo-artifacts.js";
import { actionById, fixtureLabel, formatMoney, resultHeadline, shortHash } from "./view-model.js";

type View = "run" | "fixtures" | "evidence" | "model";
type RunStage = "ready" | "replaying" | "verifying" | "complete";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (appRoot === null) throw new Error("app root is missing");
const app: HTMLDivElement = appRoot;

function fatal(message: string): never {
  app.innerHTML = `<main class="fatal-state"><div class="eyebrow">Artifact unavailable</div><h1>Worstcase could not load this checked run.</h1><p>${message}</p><button class="button button-primary" id="reload-app">Reload artifact</button></main>`;
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function moneyFor(action: DemoAction): string {
  if (action.amountBaseUnits === undefined) return "control";
  return `${formatMoney(action.amountBaseUnits, state.selected.asset.decimals, 2)} ${state.selected.asset.symbol}`;
}

function navButton(view: View, label: string): string {
  const current = state.view === view;
  return `<button class="nav-item" data-view="${view}" ${current ? 'aria-current="page"' : ""}>${label}</button>`;
}

function stageCopy(): string {
  if (state.runStage === "replaying") return "Replaying the checked local fixture artifact";
  if (state.runStage === "verifying") return "Comparing the replay projection with recorded hashes";
  return "Checked local artifact ready to replay";
}

function runButton(): string {
  const busy = state.runStage === "replaying" || state.runStage === "verifying";
  return `<button class="button button-primary" data-replay aria-busy="${busy}">
    <span class="button-dot" aria-hidden="true"></span>${busy ? "Cancel replay" : "Replay fixture"}
  </button>`;
}

/** The one (or few) calls that realise the bound. Small by design: a single-step
 * counterexample fills this cell instead of leaving a hollow ledger. */
function renderCallCell(): string {
  const result = state.selected.result;
  const ids = result.shortestPathTransitionIds;

  if (ids.length === 0) {
    return `<section class="cell cell-call" aria-labelledby="call-title">
      <div class="cell-label"><h2 id="call-title">No reachable adversarial edge</h2></div>
      <p class="cell-note">Nothing in this agent can move value to a declared adversarial recipient under its policy. The panel beside this one lists every path that was tried and the rule that stopped it.</p>
    </section>`;
  }

  const steps = ids.map((id, index) => {
    const action = actionById(state.selected, id);
    if (action === undefined) return "";
    const selected = state.selectedStep === id;
    return `<button class="step ${selected ? "is-selected" : ""}" data-step="${escapeHtml(id)}" ${selected ? 'aria-current="step"' : ""}>
      <span class="step-n">${index + 1}</span>
      <span class="step-body"><strong>${escapeHtml(fixtureLabel(id))}</strong><small>${escapeHtml(action.type)}${action.recipient === undefined ? "" : ` · ${escapeHtml(action.recipient)}`} · balance ${escapeHtml(formatMoney(state.selected.protectedBalanceBaseUnits, state.selected.asset.decimals, 2))}</small></span>
      <b class="${action.adversarial ? "is-loss" : ""}">${action.amountBaseUnits === undefined ? "—" : `−${escapeHtml(formatMoney(action.amountBaseUnits, state.selected.asset.decimals, 2))}`}</b>
    </button>`;
  }).join("");

  const focused = state.selectedStep === null ? undefined : actionById(state.selected, state.selectedStep);
  const permitted = focused === undefined
    ? ""
    : `<div class="why">
        <span class="why-label">Why it is permitted</span>
        <code>allowedRecipients.${escapeHtml(state.selected.asset.id)} includes “${escapeHtml(focused.recipient ?? "n/a")}” → <b>${state.selected.allowedRecipients.includes(focused.recipient ?? "") ? "TRUE" : "FALSE"}</b></code>
      </div>`;

  return `<section class="cell cell-call" aria-labelledby="call-title">
    <div class="cell-label"><h2 id="call-title">${ids.length === 1 ? "The call that realises it" : "The calls that realise it"}</h2><span>${ids.length} step${ids.length === 1 ? "" : "s"}</span></div>
    <div class="steps">${steps}</div>
    ${permitted}
  </section>`;
}

/** Why nothing loses more. A co-equal panel, because exhaustion is what makes the
 * figure a bound rather than a sighting — and it carries runs with no path at all.
 *
 * Two kinds of entry, both real: edges a policy rule stopped, and edges the search
 * reached but which cannot increase the loss. Listing only the first left this panel
 * empty for permissive policies, which understated how much was actually examined. */
function renderRuledOutCell(): string {
  const result = state.selected.result;
  const onPath = new Set(result.shortestPathTransitionIds);
  const blockedIds = new Set(result.blocked.map((item) => item.transitionId));

  const blockedRows = result.blocked.map((item) =>
    `<li><button class="ruled-row" data-step="${escapeHtml(item.transitionId)}"><span class="struck">${escapeHtml(fixtureLabel(item.transitionId))}</span><code>${escapeHtml(item.policyCheckId)}</code></button></li>`);

  // Reached, permitted, but cannot raise the bound — the other half of the proof.
  const inertRows = state.selected.actions
    .filter((action) => !onPath.has(action.id) && !blockedIds.has(action.id))
    .map((action) => `<li><button class="ruled-row" data-step="${escapeHtml(action.id)}"><span class="struck">${escapeHtml(fixtureLabel(action.id))}</span><code>${action.adversarial ? "no further loss" : "not adversarial"}</code></button></li>`);

  const rows = [...blockedRows, ...inertRows];
  const body = rows.length === 0
    ? `<li class="ruled-empty">Every declared action lies on the maximum-loss path.</li>`
    : rows.join("");

  const note = result.status === "UNKNOWN"
    ? "The search was truncated, so no figure is claimed. This is not a pass."
    : `The reachable space was explored and exhausted across ${result.exploredStates} state${result.exploredStates === 1 ? "" : "s"}. Had it been truncated, this panel would read UNKNOWN and no figure would be shown.`;

  return `<section class="cell cell-ruled" aria-labelledby="ruled-title">
    <div class="cell-label"><h2 id="ruled-title">Ruled out — why nothing loses more</h2><span>${rows.length} edge${rows.length === 1 ? "" : "s"}</span></div>
    <ul class="ruled">${body}</ul>
    <p class="cell-note">${escapeHtml(note)}</p>
  </section>`;
}

function renderEvidenceStrip(): string {
  const anchor = state.selected.anchor;
  const store = state.selected.storage;
  const cell = (label: string, value: string, good = false) =>
    `<div class="ev"><dt>${label}</dt><dd class="${good ? "is-good" : ""}">${value}</dd></div>`;
  return `<dl class="cell cell-evidence">
    ${cell("0G Storage", store === undefined ? "not uploaded" : "re-verified", store !== undefined)}
    ${cell("0G Chain", anchor === undefined ? "not anchored" : `anchored · ${anchor.chainId}`, anchor !== undefined)}
    ${cell("Bundle root", `<code>${escapeHtml(shortHash(state.selected.bundleRoot))}</code>`)}
    ${cell("Engine", `<code>${escapeHtml(state.selected.engineVersion)}</code>`)}
  </dl>`;
}

function renderRun(): string {
  const result = state.selected.result;
  const complete = result.status === "COMPLETE";
  const loss = complete ? BigInt(result.maximumLossBaseUnits ?? "0") : null;
  const tone = loss === 0n ? "is-clear" : complete ? "is-danger" : "is-unknown";

  // UNKNOWN replaces the figure entirely. It must never render as a zero.
  const figure = complete
    ? `<div class="figure ${tone}">${escapeHtml(formatMoney(result.maximumLossBaseUnits ?? "0", state.selected.asset.decimals, 2))}<span class="unit">${escapeHtml(state.selected.asset.symbol)}</span></div>
       <p class="claim">${loss === 0n ? "reaches the declared adversarial recipient. Nothing does." : "can reach the declared adversarial recipient."}</p>`
    : `<div class="figure is-unknown no-figure">UNKNOWN</div>
       <p class="claim">The search did not finish, so no bound is claimed. Reason: <code>${escapeHtml(result.unknownReason ?? "SEARCH_INCOMPLETE")}</code>.</p>`;

  return `<section class="bento" aria-labelledby="result-title">
    <section class="cell cell-bound ${tone}">
      <div class="cell-label"><span class="pulse ${state.runStage !== "complete" ? "is-running" : ""}" aria-hidden="true"></span>
        <h1 id="result-title">${complete ? "Maximum reachable loss · complete" : "No monetary result · unknown"}</h1></div>
      ${figure}
      <p class="cell-desc">${escapeHtml(state.selected.description)}</p>
      <p class="run-stage" role="status" aria-live="polite">${escapeHtml(stageCopy())}</p>
    </section>

    <section class="cell cell-basis" aria-label="Basis of the figure">
      <div class="cell-label"><h2>Basis of the figure</h2></div>
      <dl class="rows">
        <div><dt>Winning rule</dt><dd>maximum loss</dd></div>
        <div><dt>Tie-break</dt><dd>shortest path</dd></div>
        <div><dt>Explored</dt><dd>${result.exploredStates} states / ${result.exploredTrajectories} path${result.exploredTrajectories === 1 ? "" : "s"}</dd></div>
        <div><dt>Model support</dt><dd>${escapeHtml(state.selected.supportStatus.toLowerCase())}</dd></div>
      </dl>
    </section>

    ${renderCallCell()}
    ${renderRuledOutCell()}
    ${renderEvidenceStrip()}

    <div class="cell-actions">
      ${runButton()}
      <button class="button button-secondary" id="compare-policy">${state.selected.fixtureId === "policy-fix" ? "Return to vulnerable policy" : "Compare the policy fix"}</button>
    </div>
  </section>`;
}

function renderFixtures(): string {
  return `<section class="section-view" aria-labelledby="fixtures-title">
    <div class="section-heading"><div class="eyebrow">Fixture catalog · version 1</div><h1 id="fixtures-title">Choose one planted failure.</h1><p>Every amount below comes from the checked fixture artifact generated by engine ${escapeHtml(state.selected.engineVersion)}.</p></div>
    <div class="fixture-list">${artifacts.map((artifact) => {
      const active = artifact.fixtureId === state.selected.fixtureId;
      const amount = artifact.result.status === "COMPLETE" ? `${formatMoney(artifact.result.maximumLossBaseUnits ?? "0", artifact.asset.decimals, 2)} ${artifact.asset.symbol}` : "UNKNOWN";
      return `<button class="fixture-row" data-fixture="${escapeHtml(artifact.fixtureId)}" ${active ? 'aria-current="true"' : ""}>
        <span class="fixture-index">${String(artifacts.indexOf(artifact) + 1).padStart(2, "0")}</span>
        <span><strong>${escapeHtml(fixtureLabel(artifact.fixtureId))}</strong><small>${escapeHtml(artifact.description)}</small></span>
        <b class="${BigInt(artifact.result.maximumLossBaseUnits ?? "0") > 0n ? "is-loss" : ""}">${escapeHtml(amount)}</b>
      </button>`;
    }).join("")}</div>
  </section>`;
}

function renderEvidence(): string {
  const anchor = state.selected.anchor;
  const chainRow = anchor === undefined
    ? `<div><dt>0G Chain</dt><dd>Not anchored</dd><small>No registry event exists</small></div>`
    : `<div><dt>0G Chain</dt><dd><a href="${escapeHtml(anchor.explorerTx)}" target="_blank" rel="noopener noreferrer">Anchored on ${escapeHtml(anchor.network)}</a></dd><small>Read back from chain state and matched</small></div>
       <div><dt>Registry</dt><dd><a href="${escapeHtml(anchor.explorerContract)}" target="_blank" rel="noopener noreferrer"><code>${escapeHtml(shortHash(anchor.runRegistry))}</code></a></dd><small>Chain ${anchor.chainId}</small></div>`;

  const store = state.selected.storage;
  // Content-addressed storage creates no transaction when identical bytes are
  // already stored, so only offer a transaction link when one actually exists.
  const storageValue = store === undefined
    ? `<dd>Not uploaded</dd><small>No transaction exists</small>`
    : store.explorerTx === null
      ? `<dd>Stored and re-verified</dd><small>Identical bytes already stored, so no new transaction</small>`
      : `<dd><a href="${escapeHtml(store.explorerTx)}" target="_blank" rel="noopener noreferrer">Uploaded and re-verified</a></dd><small>Downloaded back, root re-derived, bytes identical</small>`;
  const storageRow = store === undefined
    ? `<div><dt>0G Storage</dt>${storageValue}</div>`
    : `<div><dt>0G Storage</dt>${storageValue}</div>
       <div><dt>Storage root</dt><dd><code>${escapeHtml(shortHash(store.storageRoot))}</code></dd><small>Merkle root on ${escapeHtml(store.network)}</small></div>`;

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

  return `<section class="section-view" aria-labelledby="evidence-title">
    <div class="section-heading"><div class="eyebrow">Canonical evidence</div><h1 id="evidence-title">${heading}</h1><p>${blurb}</p></div>
    <dl class="evidence-sheet">
      <div><dt>Origin</dt><dd>Local fixture</dd><small>Not 0G Compute</small></div>
      <div><dt>Bundle root</dt><dd><code>${escapeHtml(state.selected.bundleRoot)}</code></dd><small>Canonical local bytes</small></div>
      ${storageRow}
      ${chainRow}
    </dl>
    <button class="button button-secondary" id="copy-root">Copy bundle root</button>
  </section>`;
}

function renderModel(): string {
  return `<section class="section-view" aria-labelledby="model-title">
    <div class="section-heading"><div class="eyebrow">Declared model</div><h1 id="model-title">Supported actions are explicit.</h1><p>Unknown semantics must stop analysis. They are never silently interpreted as safe.</p></div>
    <div class="model-table" role="table" aria-label="Model support">
      <div role="row"><span role="columnheader">Action family</span><span role="columnheader">Status</span><span role="columnheader">Bound effect</span></div>
      ${[["transfer", "Supported", "Balance, caps, recipient, nonce"], ["callPaidTool", "Supported", "Quoted maximum transfer"], ["spawn", "Supported", "Snapshot concurrency"], ["recurse", "Supported", "Bounded depth"], ["arbitrary side effect", "Unsupported", "Returns UNKNOWN"]].map(([action, status, effect]) => `<div role="row"><code role="cell">${action}</code><span role="cell" class="${status === "Unsupported" ? "is-loss" : ""}">${status}</span><span role="cell">${effect}</span></div>`).join("")}
    </div>
    <dl class="hashes"><div><dt>Manifest</dt><dd><code>${escapeHtml(shortHash(state.selected.manifestHash))}</code></dd></div><div><dt>Policy</dt><dd><code>${escapeHtml(shortHash(state.selected.policyHash))}</code></dd></div><div><dt>Graph</dt><dd><code>${escapeHtml(shortHash(state.selected.graphHash))}</code></dd></div></dl>
  </section>`;
}

function renderMain(): string {
  if (state.view === "fixtures") return renderFixtures();
  if (state.view === "evidence") return renderEvidence();
  if (state.view === "model") return renderModel();
  return renderRun();
}

function renderMobileNav(): string {
  // Navigation only. Replay used to live in here, which mixed a primary action
  // into the nav bar and made the bar the loudest thing on a small screen.
  return `${navButton("run", "Run")}${navButton("fixtures", "Fixtures")}${navButton("evidence", "Proof")}${navButton("model", "Model")}`;
}

function render(): void {
  const anchor = state.selected.anchor;
  app.innerHTML = `<a class="skip-link" href="#main-content">Skip to main content</a><div class="app-shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark" aria-hidden="true">W</span><span>Worstcase</span></div>
      <span class="crumb">/ runs / <code>${escapeHtml(state.selected.fixtureId)}</code></span>
      <nav class="topnav" aria-label="Primary navigation">
        ${navButton("run", "Run")}${navButton("fixtures", "Fixtures")}${navButton("evidence", "Evidence")}${navButton("model", "Model")}
      </nav>
      <span class="provenance ${anchor === undefined ? "" : "is-anchored"}"><span aria-hidden="true"></span>${anchor === undefined ? "local · not anchored" : `local fixture · anchored on ${escapeHtml(anchor.network)}`}</span>
    </header>
    <main id="main-content" tabindex="-1"><div class="content">${renderMain()}</div></main>
    <nav class="mobile-nav" aria-label="Mobile navigation">${renderMobileNav()}</nav>
    ${state.notice === null ? "" : `<div class="notice" role="status">${escapeHtml(state.notice)}</div>`}
  </div>`;
  bindEvents();
}

function showNotice(message: string): void {
  state.notice = message;
  const existing = document.querySelector<HTMLDivElement>(".notice");
  if (existing !== null) existing.textContent = message;
  else document.querySelector(".app-shell")?.insertAdjacentHTML("beforeend", `<div class="notice" role="status">${escapeHtml(message)}</div>`);
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
  render();
}

function bindEvents(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => button.addEventListener("click", () => {
    state.view = button.dataset.view as View;
    state.notice = null;
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

render();
