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

function renderPath(): string {
  const result = state.selected.result;
  const ids = result.shortestPathTransitionIds;
  if (ids.length === 0) {
    return `<div class="empty-path">
      <span class="blocked-mark" aria-hidden="true">×</span>
      <div><strong>No adversarial edge is reachable.</strong><p>The tightened policy blocks all ${result.blocked.length} planted paths. Select one to inspect the policy decision.</p></div>
    </div>
    <ol class="blocked-list" aria-label="Blocked transitions">
      ${result.blocked.map((item) => `<li><button data-step="${escapeHtml(item.transitionId)}" ${state.selectedStep === item.transitionId ? 'aria-current="step"' : ""}><span>${escapeHtml(fixtureLabel(item.transitionId))}</span><code>${escapeHtml(item.policyCheckId)}</code></button></li>`).join("")}
    </ol>`;
  }

  const opening = `<li class="path-step path-origin"><span class="node" aria-hidden="true"></span><div><strong>Protected balance</strong><small>${state.selected.asset.symbol.toLowerCase()} · ${formatMoney(state.selected.protectedBalanceBaseUnits, state.selected.asset.decimals, 2)}</small></div><b>${formatMoney(state.selected.protectedBalanceBaseUnits, state.selected.asset.decimals, 2)}</b></li>`;
  const steps = ids.map((id) => {
    const action = actionById(state.selected, id);
    if (action === undefined) return "";
    const selected = state.selectedStep === id;
    return `<li class="path-step ${selected ? "is-selected" : ""}">
      <span class="node" aria-hidden="true"></span>
      <button data-step="${escapeHtml(id)}" ${selected ? 'aria-current="step"' : ""}>
        <strong>${escapeHtml(fixtureLabel(id))}</strong>
        <small>${escapeHtml(action.type)}${action.recipient === undefined ? "" : ` · ${escapeHtml(action.recipient)}`}</small>
      </button>
      <b class="${action.adversarial ? "is-loss" : ""}">${action.amountBaseUnits === undefined ? "—" : `−${escapeHtml(formatMoney(action.amountBaseUnits, state.selected.asset.decimals, 2))}`}</b>
    </li>`;
  }).join("");
  return `<ol class="path-list">${opening}${steps}</ol>`;
}

function renderDetail(): string {
  const id = state.selectedStep;
  const action = id === null ? undefined : actionById(state.selected, id);
  if (action === undefined) {
    return `<div class="detail-empty"><strong>Policy holds on every planted path.</strong><p>Select a blocked transition to inspect its policy decision.</p></div>`;
  }
  const reason = action.adversarial
    ? `${fixtureLabel(action.id)} transfers ${moneyFor(action)} to the fixture-declared adversarial recipient.`
    : `${fixtureLabel(action.id)} is legitimate spend and does not contribute to external loss.`;
  return `<div class="detail-kicker">Selected consequence</div>
    <h2>${escapeHtml(action.adversarial ? "Allowed recipient reaches the sink" : "Legitimate spend remains distinct")}</h2>
    <p>${escapeHtml(reason)}</p>
    <div class="policy-code"><code>allowedRecipients.${escapeHtml(state.selected.asset.id)}</code><br />includes “${escapeHtml(action.recipient ?? "n/a") }” → ${state.selected.allowedRecipients.includes(action.recipient ?? "") ? "TRUE" : "FALSE"}</div>
    <dl class="detail-facts">
      <div><dt>Action type</dt><dd>${escapeHtml(action.type)}</dd></div>
      <div><dt>Amount</dt><dd>${escapeHtml(moneyFor(action))}</dd></div>
      <div><dt>Counts as loss</dt><dd>${action.adversarial ? "Yes — declared sink" : "No — legitimate recipient"}</dd></div>
    </dl>`;
}

function renderRun(): string {
  const result = state.selected.result;
  const loss = result.status === "COMPLETE" ? BigInt(result.maximumLossBaseUnits ?? "0") : null;
  const statusClass = loss === 0n ? "is-clear" : result.status === "UNKNOWN" ? "is-unknown" : "is-danger";
  return `<section class="run-view" aria-labelledby="result-title">
    <div class="run-progress ${state.runStage !== "complete" ? "is-running" : ""}" role="status" aria-live="polite"><span></span><p>${escapeHtml(stageCopy())}</p></div>
    <header class="verdict">
      <div>
        <div class="eyebrow">${result.status === "COMPLETE" ? "Complete · conservative bound" : "Unknown · no monetary result"}</div>
        <h1 id="result-title" class="${statusClass}">${escapeHtml(resultHeadline(state.selected))}</h1>
        <p>${escapeHtml(state.selected.description)}</p>
      </div>
      <dl class="basis">
        <div><dt>Winning rule</dt><dd>maximum loss</dd></div>
        <div><dt>Tie-break</dt><dd>shortest path</dd></div>
        <div><dt>Explored</dt><dd>${result.exploredStates} states / ${result.exploredTrajectories} path${result.exploredTrajectories === 1 ? "" : "s"}</dd></div>
        <div><dt>Model</dt><dd>${state.selected.supportStatus.toLowerCase()}</dd></div>
      </dl>
    </header>
    <div class="ledger-grid">
      <section class="ledger panel" aria-labelledby="path-title">
        <header><h2 id="path-title">Shortest maximum-loss path</h2><span>Protected balance → sink</span></header>
        ${renderPath()}
      </section>
      <aside class="detail panel" aria-live="polite">${renderDetail()}</aside>
    </div>
    <div class="result-actions">
      ${runButton()}
      <button class="button button-secondary" id="compare-policy">${state.selected.fixtureId === "policy-fix" ? "Return to vulnerable policy" : "Compare policy fix"}</button>
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
    : "Reproducible locally, verifiable on 0G Chain.";
  const blurb = anchor === undefined
    ? "This bundle is generated from the exact fixture, policy, graph, engine, and deterministic result. It does not claim 0G provenance."
    : "This bundle is generated from the exact fixture, policy, graph, engine, and deterministic result. Its root and maximum loss are bound on 0G Chain to the model version that produced them.";

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
  if (state.view === "run") {
    const busy = state.runStage === "replaying" || state.runStage === "verifying";
    return `<button class="mobile-replay" data-replay aria-busy="${busy}">${busy ? "Cancel" : "Replay"}</button>${navButton("fixtures", "Fixtures")}${navButton("evidence", "Proof")}${navButton("model", "Model")}`;
  }
  return `${navButton("run", "Run")}${navButton("fixtures", "Fixtures")}${navButton("evidence", "Proof")}${navButton("model", "Model")}`;
}

function render(): void {
  app.innerHTML = `<a class="skip-link" href="#main-content">Skip to main content</a><div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>Worstcase</span></div>
      <nav aria-label="Primary navigation">
        ${navButton("run", "Run")}${navButton("fixtures", "Fixtures")}${navButton("evidence", "Evidence")}${navButton("model", "Model support")}
      </nav>
      <div class="sidebar-meta"><code>engine ${escapeHtml(state.selected.engineVersion)}</code><span>${state.selected.anchor === undefined ? "Local evidence only" : `Anchored · chain ${state.selected.anchor.chainId}`}</span></div>
    </aside>
    <main id="main-content" tabindex="-1">
      <header class="topbar"><div class="breadcrumb"><b>Worstcase</b><span class="desktop-context">/ ${state.view === "run" ? "Runs" : fixtureLabel(state.view)} / <code>${escapeHtml(state.selected.fixtureId)}</code></span><span class="mobile-context">/ ${escapeHtml(state.selected.fixtureId)}</span></div><div class="provenance"><span aria-hidden="true"></span>${state.selected.anchor === undefined ? "Local fixture · not anchored" : `Local fixture · anchored on ${escapeHtml(state.selected.anchor.network)}`}</div></header>
      <div class="content">${renderMain()}</div>
    </main>
    <nav class="mobile-nav" aria-label="Mobile actions and navigation">${renderMobileNav()}</nav>
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
