import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AdapterRequestSchema,
  AdapterEndpointPolicySchema,
  FileMutationJournal,
  InMemoryMutationJournal,
  assertWriteApproval,
  collectVerifiedCandidate,
  executeAdapterRequest,
  hashAdapterBytes,
  runAdapterProcess,
  runFramedAdapterProcess,
  reconcileSubmissions,
  assertAllowedEndpoint,
  type AdapterOperationHandler,
  type ComputePort,
  type MutationContext,
  type ProviderCandidate,
} from "../../packages/zerog/src/index.js";

function context(overrides: Partial<MutationContext["approval"]> = {}): MutationContext {
  return {
    idempotencyKey: "evidence-upload-0001",
    canonicalRequestHash: `0x${"1".repeat(64)}`,
    approval: {
      approvalId: "approval-1",
      action: "STORAGE_UPLOAD",
      scope: "bundle:abc",
      network: "galileo",
      canonicalRequestHash: `0x${"1".repeat(64)}`,
      maximumSpendBaseUnits: "1000000",
      expiresAtUnixMs: 2_000,
      ...overrides,
    },
  };
}

describe("0G mutation boundaries", () => {
  it("accepts a matching unexpired single-purpose approval", () => {
    expect(() => assertWriteApproval(context(), "STORAGE_UPLOAD", "bundle:abc", "galileo", 1_000)).not.toThrow();
  });

  it("fails closed for an expired approval", () => {
    expect(() => assertWriteApproval(context(), "STORAGE_UPLOAD", "bundle:abc", "galileo", 2_000)).toThrow("EXTERNAL_WRITE_NOT_APPROVED");
  });

  it("fails closed for action or scope confusion", () => {
    expect(() => assertWriteApproval(context(), "CHAIN_ANCHOR", "bundle:abc", "galileo", 1_000)).toThrow("EXTERNAL_WRITE_NOT_APPROVED");
    expect(() => assertWriteApproval(context(), "STORAGE_UPLOAD", "bundle:other", "galileo", 1_000)).toThrow("EXTERNAL_WRITE_NOT_APPROVED");
    expect(() => assertWriteApproval(context(), "STORAGE_UPLOAD", "bundle:abc", "mainnet", 1_000)).toThrow("EXTERNAL_WRITE_NOT_APPROVED");
  });

  it("rejects weak idempotency keys before approval use", () => {
    const invalid = { ...context(), idempotencyKey: "short" };
    expect(() => assertWriteApproval(invalid, "STORAGE_UPLOAD", "bundle:abc", "galileo", 1_000)).toThrow("IDEMPOTENCY_KEY_INVALID");
  });
});

describe("isolated adapter protocol", () => {
  const base = {
    protocolVersion: "1",
    requestId: "request-1",
    network: "galileo",
    canonicalRequestHash: `0x${"1".repeat(64)}`,
    payloadBase64: "e30=",
  } as const;

  it("allows discovery without mutation approval", () => {
    expect(AdapterRequestSchema.safeParse({ ...base, operation: "COMPUTE_DISCOVER" }).success).toBe(true);
  });

  it("requires mutation approval bound to operation, network, and request", () => {
    expect(AdapterRequestSchema.safeParse({ ...base, operation: "COMPUTE_PROBE" }).success).toBe(false);
    const approval = {
      approvalId: "approval-1",
      action: "COMPUTE_PROBE",
      scope: `compute:${base.canonicalRequestHash}`,
      network: base.network,
      canonicalRequestHash: base.canonicalRequestHash,
      maximumSpendBaseUnits: "1000",
      expiresAtUnixMs: 4_000_000_000_000,
    } as const;
    expect(AdapterRequestSchema.safeParse({ ...base, operation: "COMPUTE_PROBE", idempotencyKey: "compute-probe-0001", approval }).success).toBe(true);
    expect(AdapterRequestSchema.safeParse({ ...base, operation: "COMPUTE_PROBE", idempotencyKey: "compute-probe-0001", approval: { ...approval, network: "mainnet" } }).success).toBe(false);
    expect(AdapterRequestSchema.safeParse({ ...base, operation: "COMPUTE_PROBE", idempotencyKey: "compute-probe-0001", approval: { ...approval, scope: "compute:wrong" } }).success).toBe(false);
  });

  it("rejects unknown envelope fields and oversized payloads", () => {
    expect(AdapterRequestSchema.safeParse({ ...base, operation: "CHAIN_READ", extra: true }).success).toBe(false);
    expect(AdapterRequestSchema.safeParse({ ...base, operation: "CHAIN_READ", payloadBase64: "a".repeat(2_796_205) }).success).toBe(false);
  });
});

describe("adapter endpoint allowlist", () => {
  it("admits only checked-in HTTPS origins for the exact operation", async () => {
    const policyPath = fileURLToPath(new URL("../../deploy/adapter/endpoints.galileo.json", import.meta.url));
    const policy = AdapterEndpointPolicySchema.parse(JSON.parse(await readFile(policyPath, "utf8")));
    expect(() => assertAllowedEndpoint(policy, "galileo", "STORAGE_UPLOAD", "https://indexer-storage-testnet-turbo.0g.ai")).not.toThrow();
    expect(() => assertAllowedEndpoint(policy, "galileo", "CHAIN_READ", "https://indexer-storage-testnet-turbo.0g.ai")).toThrow("ENDPOINT_NOT_ALLOWED");
    expect(() => assertAllowedEndpoint(policy, "mainnet", "STORAGE_UPLOAD", "https://indexer-storage-testnet-turbo.0g.ai")).toThrow("ENDPOINT_NETWORK_MISMATCH");
  });

  it("rejects credentials, paths, queries, plaintext, and unlisted origins", () => {
    const policy = AdapterEndpointPolicySchema.parse({ protocolVersion: "1", network: "galileo", operations: { CHAIN_READ: ["https://evmrpc-testnet.0g.ai"] } });
    for (const endpoint of [
      "https://user@example.com",
      "https://evmrpc-testnet.0g.ai/rpc",
      "https://evmrpc-testnet.0g.ai?redirect=evil",
      "http://evmrpc-testnet.0g.ai",
      "https://evil.example",
    ]) expect(() => assertAllowedEndpoint(policy, "galileo", "CHAIN_READ", endpoint)).toThrow();
  });

  it("keeps the proxy deny rules ahead of the exact-domain allow rule", async () => {
    const configPath = fileURLToPath(new URL("../../deploy/adapter/squid-storage-chain.conf", import.meta.url));
    const config = await readFile(configPath, "utf8");
    const lines = config.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const allowIndex = lines.indexOf("http_access allow zerog_storage_chain");
    const denyAllIndex = lines.indexOf("http_access deny all");
    expect(lines).toContain("acl zerog_storage_chain dstdomain evmrpc-testnet.0g.ai indexer-storage-testnet-turbo.0g.ai");
    for (const requiredDeny of ["http_access deny !CONNECT", "http_access deny !SSL_ports", "http_access deny private_v4", "http_access deny private_v6"]) {
      expect(lines.indexOf(requiredDeny)).toBeGreaterThanOrEqual(0);
      expect(lines.indexOf(requiredDeny)).toBeLessThan(allowIndex);
    }
    expect(allowIndex).toBeGreaterThanOrEqual(0);
    expect(denyAllIndex).toBeGreaterThan(allowIndex);
  });
});

describe("isolated adapter execution runtime", () => {
  const payload = new TextEncoder().encode('{"fixture":"prompt-injection"}');
  const canonicalRequestHash = hashAdapterBytes(payload);
  const payloadBase64 = Buffer.from(payload).toString("base64");
  const approval = {
    approvalId: "approval-compute-runtime",
    action: "COMPUTE_PROBE",
    scope: `compute:${canonicalRequestHash}`,
    network: "galileo",
    canonicalRequestHash,
    maximumSpendBaseUnits: "1000",
    expiresAtUnixMs: 4_000_000_000_000,
  } as const;
  const request = {
    protocolVersion: "1",
    requestId: "runtime-request-1",
    operation: "COMPUTE_PROBE",
    network: "galileo",
    canonicalRequestHash,
    payloadBase64,
    idempotencyKey: "runtime-compute-0001",
    approval,
  } as const;
  const signal = new AbortController().signal;
  const journalWorkerPath = fileURLToPath(new URL("./helpers/journal-worker.ts", import.meta.url));

  async function runJournalWorker(mode: "reserve" | "reserve-and-hold", directory: string): Promise<{ child: ReturnType<typeof spawn>; decision: { status: string } }> {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", journalWorkerPath, mode, directory, request.idempotencyKey, canonicalRequestHash], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });

    while (!stdout.includes("\n")) {
      const outcome = await Promise.race([
        once(child.stdout, "data").then(() => "data" as const),
        once(child, "exit").then(() => "exit" as const),
      ]);
      if (outcome === "exit") throw new Error(`journal worker exited before response: ${stderr}`);
    }
    return { child, decision: JSON.parse(stdout.trim()) as { status: string } };
  }

  async function waitForChildExit(child: ReturnType<typeof spawn>): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await once(child, "exit");
  }

  function handler(overrides: Partial<AdapterOperationHandler> = {}, onExecute: () => void = () => undefined): AdapterOperationHandler {
    return {
      operation: "COMPUTE_PROBE",
      prepare: async () => ({
        quotedMaximumSpendBaseUnits: "900",
        execute: async () => {
          onExecute();
          return { resultBytes: new TextEncoder().encode('{"trajectory":["pay-attacker"]}'), actualSpendBaseUnits: "700" };
        },
      }),
      ...overrides,
    };
  }

  it("binds the canonical request hash to the decoded payload before handler preparation", async () => {
    let prepared = false;
    const response = await executeAdapterRequest(
      { ...request, canonicalRequestHash: `0x${"f".repeat(64)}`, approval: { ...approval, canonicalRequestHash: `0x${"f".repeat(64)}`, scope: `compute:0x${"f".repeat(64)}` } },
      handler({ prepare: async () => { prepared = true; throw new Error("must not prepare"); } }),
      new InMemoryMutationJournal(), signal, 1_000,
    );
    expect(response).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(prepared).toBe(false);
  });

  it("rejects an expired approval before handler preparation", async () => {
    let prepared = false;
    const response = await executeAdapterRequest(
      { ...request, approval: { ...approval, expiresAtUnixMs: 1_000 } },
      handler({ prepare: async () => { prepared = true; throw new Error("must not prepare"); } }),
      new InMemoryMutationJournal(), signal, 1_000,
    );
    expect(response).toMatchObject({ ok: false, code: "EXTERNAL_WRITE_NOT_APPROVED" });
    expect(prepared).toBe(false);
  });

  it("rejects malformed or non-canonical base64 before handler preparation", async () => {
    let prepared = false;
    const response = await executeAdapterRequest(
      { ...request, payloadBase64: "%%%" },
      handler({ prepare: async () => { prepared = true; throw new Error("must not prepare"); } }),
      new InMemoryMutationJournal(), signal, 1_000,
    );
    expect(response).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(prepared).toBe(false);
  });

  it("refuses a quoted spend above the exact approval cap before execution", async () => {
    let executed = false;
    const expensive = handler({ prepare: async () => ({ quotedMaximumSpendBaseUnits: "1001", execute: async () => { executed = true; return { resultBytes: new Uint8Array(), actualSpendBaseUnits: "1001" }; } }) });
    await expect(executeAdapterRequest(request, expensive, new InMemoryMutationJournal(), signal, 1_000)).resolves.toMatchObject({ ok: false, code: "SPEND_CAP_EXCEEDED" });
    expect(executed).toBe(false);
  });

  it("returns the durable completed response for an identical idempotent retry", async () => {
    let executions = 0;
    const journal = new InMemoryMutationJournal();
    const adapter = handler({}, () => { executions += 1; });
    const first = await executeAdapterRequest(request, adapter, journal, signal, 1_000);
    const second = await executeAdapterRequest(request, adapter, journal, signal, 1_000);
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(executions).toBe(1);
  });

  it("rejects reuse of an idempotency key for different canonical bytes", async () => {
    let executions = 0;
    const journal = new InMemoryMutationJournal();
    const adapter = handler({}, () => { executions += 1; });
    await executeAdapterRequest(request, adapter, journal, signal, 1_000);
    const otherPayload = new TextEncoder().encode('{"fixture":"replay"}');
    const otherHash = hashAdapterBytes(otherPayload);
    const conflicting = {
      ...request,
      canonicalRequestHash: otherHash,
      payloadBase64: Buffer.from(otherPayload).toString("base64"),
      approval: { ...approval, canonicalRequestHash: otherHash, scope: `compute:${otherHash}` },
    };
    await expect(executeAdapterRequest(conflicting, adapter, journal, signal, 1_000)).resolves.toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(executions).toBe(1);
  });

  it("quarantines an ambiguous mutation and does not execute it again", async () => {
    let executions = 0;
    const journal = new InMemoryMutationJournal();
    const failing = handler({ prepare: async () => ({ quotedMaximumSpendBaseUnits: "900", execute: async () => { executions += 1; throw new Error("connection lost after submit"); } }) });
    const first = await executeAdapterRequest(request, failing, journal, signal, 1_000);
    const second = await executeAdapterRequest(request, failing, journal, signal, 1_000);
    expect(first).toMatchObject({ ok: false, code: "AMBIGUOUS_SUBMISSION", retryable: false });
    expect(second).toMatchObject({ ok: false, code: "AMBIGUOUS_SUBMISSION", retryable: false });
    expect(executions).toBe(1);
  });

  it("treats actual spend above the pre-execution quote as ambiguous", async () => {
    const underquoted = handler({ prepare: async () => ({ quotedMaximumSpendBaseUnits: "900", execute: async () => ({ resultBytes: new Uint8Array(), actualSpendBaseUnits: "901" }) }) });
    await expect(executeAdapterRequest(request, underquoted, new InMemoryMutationJournal(), signal, 1_000)).resolves.toMatchObject({ ok: false, code: "AMBIGUOUS_SUBMISSION" });
  });

  it("allows a zero-spend read without approval or an idempotency key", async () => {
    const readRequest = { protocolVersion: "1", requestId: "storage-root-1", operation: "STORAGE_ROOT", network: "galileo", canonicalRequestHash, payloadBase64 } as const;
    const readHandler: AdapterOperationHandler = {
      operation: "STORAGE_ROOT",
      prepare: async () => ({ quotedMaximumSpendBaseUnits: "0", execute: async () => ({ resultBytes: new TextEncoder().encode(canonicalRequestHash), actualSpendBaseUnits: "0" }) }),
    };
    await expect(executeAdapterRequest(readRequest, readHandler, new InMemoryMutationJournal(), signal, 1_000)).resolves.toMatchObject({ ok: true, requestId: "storage-root-1" });
  });

  it("replays a completed mutation after reconstructing the file journal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worstcase-journal-"));
    try {
      let executions = 0;
      const first = await executeAdapterRequest(request, handler({}, () => { executions += 1; }), new FileMutationJournal(directory), signal, 1_000);
      const second = await executeAdapterRequest(request, handler({}, () => { executions += 1; }), new FileMutationJournal(directory), signal, 1_000);
      expect(first.ok).toBe(true);
      expect(second).toEqual(first);
      expect(executions).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists ambiguous mutation state across journal reconstruction", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worstcase-journal-"));
    try {
      let executions = 0;
      const failing = handler({ prepare: async () => ({ quotedMaximumSpendBaseUnits: "900", execute: async () => { executions += 1; throw new Error("connection lost after submit"); } }) });
      const first = await executeAdapterRequest(request, failing, new FileMutationJournal(directory), signal, 1_000);
      const second = await executeAdapterRequest(request, failing, new FileMutationJournal(directory), signal, 1_000);
      expect(first).toMatchObject({ ok: false, code: "AMBIGUOUS_SUBMISSION" });
      expect(second).toMatchObject({ ok: false, code: "AMBIGUOUS_SUBMISSION" });
      expect(executions).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists idempotency conflicts while the original reservation is unresolved", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worstcase-journal-"));
    try {
      const first = new FileMutationJournal(directory);
      await expect(first.reserve(request.idempotencyKey, canonicalRequestHash)).resolves.toEqual({ status: "RESERVED" });
      const conflictingHash = `0x${"f".repeat(64)}` as const;
      await expect(new FileMutationJournal(directory).reserve(request.idempotencyKey, conflictingHash)).resolves.toEqual({ status: "CONFLICT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("allows exactly one reservation across concurrent processes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worstcase-journal-"));
    try {
      const [first, second] = await Promise.all([
        runJournalWorker("reserve", directory),
        runJournalWorker("reserve", directory),
      ]);
      await Promise.all([waitForChildExit(first.child), waitForChildExit(second.child)]);
      expect([first.decision.status, second.decision.status].sort()).toEqual(["AMBIGUOUS", "RESERVED"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails closed after the reserving process is killed before completion", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worstcase-journal-"));
    try {
      const worker = await runJournalWorker("reserve-and-hold", directory);
      expect(worker.decision).toEqual({ status: "RESERVED" });
      worker.child.kill("SIGKILL");
      await waitForChildExit(worker.child);
      await expect(new FileMutationJournal(directory).reserve(request.idempotencyKey, canonicalRequestHash)).resolves.toEqual({ status: "AMBIGUOUS" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("isolated adapter process supervisor", () => {
  const payload = new TextEncoder().encode('{"fixture":"process-boundary"}');
  const canonicalRequestHash = hashAdapterBytes(payload);
  const readRequest = {
    protocolVersion: "1",
    requestId: "process-read-1",
    operation: "STORAGE_ROOT",
    network: "galileo",
    canonicalRequestHash,
    payloadBase64: Buffer.from(payload).toString("base64"),
  } as const;
  const workerPath = fileURLToPath(new URL("./helpers/adapter-process-worker.ts", import.meta.url));
  const framedWorkerPath = fileURLToPath(new URL("./helpers/framed-adapter-worker.ts", import.meta.url));

  function processSpec(mode: string, overrides: Record<string, unknown> = {}) {
    return {
      executablePath: process.execPath,
      arguments: ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", workerPath, mode],
      workingDirectory: process.cwd(),
      environment: { WORSTCASE_ALLOWED: "yes" },
      timeoutMs: 10_000,
      ...overrides,
    };
  }

  it("passes only the explicitly allowlisted child environment", async () => {
    process.env.WORSTCASE_PARENT_SENTINEL = "must-not-leak";
    try {
      const response = await runAdapterProcess(readRequest, processSpec("success"), new AbortController().signal);
      expect(response.ok).toBe(true);
      if (!response.ok) throw new Error("expected adapter response");
      expect(JSON.parse(Buffer.from(response.resultBase64, "base64").toString("utf8"))).toEqual({ allowed: true, inherited: false });
    } finally {
      delete process.env.WORSTCASE_PARENT_SENTINEL;
    }
  }, 30_000);

  it("bounds child output and rejects malformed or hash-inconsistent responses", async () => {
    await expect(runAdapterProcess(readRequest, processSpec("oversized", { maximumResponseBytes: 1_024 }), new AbortController().signal)).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_UNAVAILABLE" });
    await expect(runAdapterProcess(readRequest, processSpec("malformed"), new AbortController().signal)).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_UNAVAILABLE" });
    await expect(runAdapterProcess(readRequest, processSpec("hash-mismatch"), new AbortController().signal)).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_UNAVAILABLE" });
  }, 30_000);

  it("returns a read timeout but treats a mutation timeout as ambiguous", async () => {
    await expect(runAdapterProcess(readRequest, processSpec("timeout", { timeoutMs: 100 }), new AbortController().signal)).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_TIMEOUT", retryable: true });
    const mutationRequest = {
      ...readRequest,
      requestId: "process-mutation-1",
      operation: "STORAGE_UPLOAD",
      idempotencyKey: "process-storage-0001",
      approval: {
        approvalId: "process-approval-1",
        action: "STORAGE_UPLOAD",
        scope: `bundle:${canonicalRequestHash}`,
        network: "galileo",
        canonicalRequestHash,
        maximumSpendBaseUnits: "1000",
        expiresAtUnixMs: 4_000_000_000_000,
      },
    } as const;
    await expect(runAdapterProcess(mutationRequest, processSpec("timeout", { timeoutMs: 100 }), new AbortController().signal)).resolves.toMatchObject({ ok: false, code: "AMBIGUOUS_SUBMISSION", retryable: false });
  }, 30_000);

  it("durably acknowledges every replacement hash before the child completes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worstcase-journal-"));
    try {
      const mutationRequest = {
        ...readRequest,
        requestId: "framed-mutation-1",
        operation: "STORAGE_UPLOAD",
        idempotencyKey: "framed-storage-0001",
        approval: {
          approvalId: "framed-approval-1",
          action: "STORAGE_UPLOAD",
          scope: `bundle:${canonicalRequestHash}`,
          network: "galileo",
          canonicalRequestHash,
          maximumSpendBaseUnits: "1000",
          expiresAtUnixMs: 4_000_000_000_000,
        },
      } as const;
      const journal = new FileMutationJournal(directory);
      await expect(journal.reserve(mutationRequest.idempotencyKey, canonicalRequestHash)).resolves.toEqual({ status: "RESERVED" });
      const spec = processSpec("unused", { arguments: ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", framedWorkerPath], timeoutMs: 10_000 });
      const response = await runFramedAdapterProcess(mutationRequest, spec, journal, new AbortController().signal);
      expect(response.ok).toBe(true);
      await expect(journal.submissions(mutationRequest.idempotencyKey, canonicalRequestHash)).resolves.toEqual([
        { transactionHash: `0x${"a".repeat(64)}`, nonce: "7" },
        { transactionHash: `0x${"b".repeat(64)}`, nonce: "7" },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("quarantines a journal that omits its submission history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worstcase-journal-"));
    const idempotencyKey = "malformed-journal-0001";
    try {
      const journal = new FileMutationJournal(directory);
      await expect(journal.reserve(idempotencyKey, canonicalRequestHash)).resolves.toEqual({ status: "RESERVED" });
      const [entryDirectory] = await readdir(directory);
      expect(entryDirectory).toBeDefined();
      await writeFile(join(directory, entryDirectory!, "state.json"), `${JSON.stringify({ state: "RESERVED", canonicalRequestHash })}\n`, "utf8");
      const reconstructed = new FileMutationJournal(directory);
      await expect(reconstructed.reserve(idempotencyKey, canonicalRequestHash)).resolves.toEqual({ status: "AMBIGUOUS" });
      await expect(reconstructed.submissions(idempotencyKey, canonicalRequestHash)).rejects.toThrow("JOURNAL_STATE_INVALID");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("replacement transaction reconciliation", () => {
  const submissions = [
    { transactionHash: `0x${"a".repeat(64)}` as const, nonce: "7" },
    { transactionHash: `0x${"b".repeat(64)}` as const, nonce: "7" },
  ];

  it("allows retry only when every recorded hash is explicitly dropped", () => {
    expect(reconcileSubmissions(submissions, [
      { ...submissions[0]!, status: "DROPPED" },
      { ...submissions[1]!, status: "DROPPED" },
    ])).toEqual({ status: "SAFE_TO_RETRY" });
    expect(reconcileSubmissions(submissions, [{ ...submissions[0]!, status: "DROPPED" }])).toEqual({ status: "UNRESOLVED" });
    expect(reconcileSubmissions(submissions, [
      { ...submissions[0]!, status: "DROPPED" },
      { ...submissions[1]!, status: "PENDING" },
    ])).toEqual({ status: "UNRESOLVED" });
  });

  it("returns the sole confirmed replacement and rejects contradictory confirmations", () => {
    expect(reconcileSubmissions(submissions, [
      { ...submissions[0]!, status: "DROPPED" },
      { ...submissions[1]!, status: "CONFIRMED" },
    ])).toEqual({ status: "SETTLED", transactionHashes: [submissions[1]!.transactionHash] });
    expect(reconcileSubmissions(submissions, [
      { ...submissions[0]!, status: "CONFIRMED" },
      { ...submissions[1]!, status: "CONFIRMED" },
    ])).toEqual({ status: "INCONSISTENT" });
  });

  it("separates replacements by nonce and exposes partial settlement", () => {
    const multiNonce = [...submissions, { transactionHash: `0x${"c".repeat(64)}` as const, nonce: "8" }];
    expect(reconcileSubmissions(multiNonce, [
      { ...submissions[0]!, status: "DROPPED" },
      { ...submissions[1]!, status: "CONFIRMED" },
      { ...multiNonce[2]!, status: "DROPPED" },
    ])).toEqual({ status: "PARTIALLY_SETTLED", transactionHashes: [submissions[1]!.transactionHash] });
  });
});

const requestHash = `0x${"a".repeat(64)}` as const;
const candidate: ProviderCandidate = {
  providerId: "provider-1",
  requestHash,
  responseHash: `0x${"b".repeat(64)}`,
  transitionIds: ["pay-attacker"],
  provenance: { mode: "test-double" },
};

function computePort(overrides: Partial<ComputePort> = {}): ComputePort {
  return {
    listEligibleProviders: async () => ["provider-1"],
    runTrajectoryProbe: async () => candidate,
    verifyCandidate: async () => true,
    ...overrides,
  };
}

describe("0G Compute fail-closed candidate boundary", () => {
  const signal = new AbortController().signal;
  const probeContext: MutationContext = {
    idempotencyKey: "compute-probe-0001",
    canonicalRequestHash: requestHash,
    approval: {
      approvalId: "approval-compute-1",
      action: "COMPUTE_PROBE",
      scope: `compute:${requestHash}`,
      network: "galileo",
      canonicalRequestHash: requestHash,
      maximumSpendBaseUnits: "1000000",
      expiresAtUnixMs: 4_000_000_000_000,
    },
  };

  it("accepts only a context-bound, graph-contained, verified candidate", async () => {
    await expect(collectVerifiedCandidate(computePort(), new Uint8Array(), requestHash, probeContext, "galileo", new Set(["pay-attacker"]), signal)).resolves.toMatchObject({ accepted: true });
  });

  it("rejects request-context mismatch before provenance acceptance", async () => {
    const wrong = { ...candidate, requestHash: `0x${"c".repeat(64)}` as const };
    await expect(collectVerifiedCandidate(computePort({ runTrajectoryProbe: async () => wrong }), new Uint8Array(), requestHash, probeContext, "galileo", new Set(["pay-attacker"]), signal)).resolves.toEqual({ accepted: false, code: "CONTEXT_MISMATCH" });
  });

  it("rejects graph-external actions", async () => {
    const external = { ...candidate, transitionIds: ["invented-transfer"] };
    await expect(collectVerifiedCandidate(computePort({ runTrajectoryProbe: async () => external }), new Uint8Array(), requestHash, probeContext, "galileo", new Set(["pay-attacker"]), signal)).resolves.toEqual({ accepted: false, code: "GRAPH_EXTERNAL_ACTION" });
  });

  it("rejects failed or throwing provenance verification", async () => {
    await expect(collectVerifiedCandidate(computePort({ verifyCandidate: async () => false }), new Uint8Array(), requestHash, probeContext, "galileo", new Set(["pay-attacker"]), signal)).resolves.toEqual({ accepted: false, code: "PROVIDER_EVIDENCE_INVALID" });
    await expect(collectVerifiedCandidate(computePort({ verifyCandidate: async () => { throw new Error("provider failure"); } }), new Uint8Array(), requestHash, probeContext, "galileo", new Set(["pay-attacker"]), signal)).resolves.toEqual({ accepted: false, code: "PROVIDER_EVIDENCE_INVALID" });
  });

  it("turns provider transport failure into an unavailable outcome", async () => {
    const failed = computePort({ runTrajectoryProbe: async () => { throw new Error("timeout"); } });
    await expect(collectVerifiedCandidate(failed, new Uint8Array(), requestHash, probeContext, "galileo", new Set(["pay-attacker"]), signal)).resolves.toEqual({ accepted: false, code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("does not call the provider without exact compute approval", async () => {
    let called = false;
    const port = computePort({ runTrajectoryProbe: async () => { called = true; return candidate; } });
    const wrongNetwork = { ...probeContext, approval: { ...probeContext.approval, network: "mainnet" } };
    await expect(collectVerifiedCandidate(port, new Uint8Array(), requestHash, wrongNetwork, "galileo", new Set(["pay-attacker"]), signal)).resolves.toEqual({ accepted: false, code: "EXTERNAL_WRITE_NOT_APPROVED" });
    expect(called).toBe(false);
  });
});
