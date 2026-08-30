import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";

const HashHexSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const IdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/);
const mutationOperations = ["COMPUTE_PROBE", "STORAGE_UPLOAD", "CHAIN_ANCHOR"] as const;
type MutationOperation = typeof mutationOperations[number];

function isMutationOperation(operation: string): operation is MutationOperation {
  return mutationOperations.includes(operation as MutationOperation);
}

function requiredScope(operation: MutationOperation, canonicalRequestHash: string): string {
  if (operation === "COMPUTE_PROBE") return `compute:${canonicalRequestHash}`;
  if (operation === "STORAGE_UPLOAD") return `bundle:${canonicalRequestHash}`;
  return `anchor:${canonicalRequestHash}`;
}
const ApprovalSchema = z.object({
  approvalId: z.string().min(1).max(128),
  action: z.enum(["COMPUTE_PROBE", "STORAGE_UPLOAD", "CHAIN_ANCHOR"]),
  scope: z.string().min(1).max(256),
  network: z.string().min(1).max(64),
  canonicalRequestHash: HashHexSchema,
  maximumSpendBaseUnits: z.string().regex(/^(0|[1-9][0-9]*)$/).max(79),
  expiresAtUnixMs: z.number().int().positive(),
}).strict();

const EndpointSchema = z.string().url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || (url.pathname !== "" && url.pathname !== "/")) {
    context.addIssue({ code: "custom", message: "endpoint must be a credential-free HTTPS origin" });
  }
});

export const AdapterEndpointPolicySchema = z.object({
  protocolVersion: z.literal("1"),
  network: z.string().min(1).max(64),
  operations: z.partialRecord(z.enum(["COMPUTE_DISCOVER", "COMPUTE_PROBE", "STORAGE_ROOT", "STORAGE_UPLOAD", "STORAGE_DOWNLOAD", "CHAIN_READ", "CHAIN_ANCHOR"]), z.array(EndpointSchema).max(16)),
}).strict();

export type AdapterEndpointPolicy = z.infer<typeof AdapterEndpointPolicySchema>;

export function assertAllowedEndpoint(policy: AdapterEndpointPolicy, network: string, operation: AdapterRequest["operation"], endpoint: string): void {
  const parsedPolicy = AdapterEndpointPolicySchema.parse(policy);
  if (parsedPolicy.network !== network) throw new Error("ENDPOINT_NETWORK_MISMATCH");
  const parsedEndpoint = EndpointSchema.parse(endpoint);
  const normalized = new URL(parsedEndpoint).origin;
  if (!(parsedPolicy.operations[operation] ?? []).some((allowed) => new URL(allowed).origin === normalized)) throw new Error("ENDPOINT_NOT_ALLOWED");
}

export const AdapterRequestSchema = z.object({
  protocolVersion: z.literal("1"),
  requestId: z.string().regex(/^[a-z][a-z0-9-]{0,127}$/),
  operation: z.enum(["COMPUTE_DISCOVER", "COMPUTE_PROBE", "STORAGE_ROOT", "STORAGE_UPLOAD", "STORAGE_DOWNLOAD", "CHAIN_READ", "CHAIN_ANCHOR"]),
  network: z.string().min(1).max(64),
  canonicalRequestHash: HashHexSchema,
  payloadBase64: z.string().max(2_796_204),
  idempotencyKey: IdempotencyKeySchema.optional(),
  approval: ApprovalSchema.optional(),
}).strict().superRefine((value, context) => {
  const mutationAction = isMutationOperation(value.operation);
  if (mutationAction && value.approval === undefined) context.addIssue({ code: "custom", message: "mutation operation requires approval", path: ["approval"] });
  if (mutationAction && value.idempotencyKey === undefined) context.addIssue({ code: "custom", message: "mutation operation requires idempotency key", path: ["idempotencyKey"] });
  if (!mutationAction && value.idempotencyKey !== undefined) context.addIssue({ code: "custom", message: "read operation cannot carry mutation idempotency key", path: ["idempotencyKey"] });
  if (value.approval !== undefined && (value.approval.action !== value.operation || value.approval.network !== value.network || value.approval.canonicalRequestHash !== value.canonicalRequestHash)) {
    context.addIssue({ code: "custom", message: "approval is not bound to adapter request", path: ["approval"] });
  }
  if (isMutationOperation(value.operation)) {
    if (value.approval !== undefined && value.approval.scope !== requiredScope(value.operation, value.canonicalRequestHash)) {
      context.addIssue({ code: "custom", message: "approval scope is not bound to adapter operation", path: ["approval", "scope"] });
    }
  }
});

export const AdapterResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), requestId: z.string(), resultHash: HashHexSchema, resultBase64: z.string().max(2_796_204) }).strict(),
  z.object({
    ok: z.literal(false),
    requestId: z.string(),
    code: z.enum(["INVALID_REQUEST", "EXTERNAL_WRITE_NOT_APPROVED", "FUNDING_REQUIRED", "SPEND_CAP_EXCEEDED", "DEPENDENCY_UNAVAILABLE", "DEPENDENCY_TIMEOUT", "PROVIDER_EVIDENCE_INVALID", "PROOF_VERIFICATION_FAILED", "AMBIGUOUS_SUBMISSION"]),
    retryable: z.boolean(),
  }).strict(),
]);

export type AdapterRequest = z.infer<typeof AdapterRequestSchema>;
export type AdapterResponse = z.infer<typeof AdapterResponseSchema>;

export type PreparedAdapterCall = Readonly<{
  quotedMaximumSpendBaseUnits: string;
  execute(signal: AbortSignal): Promise<Readonly<{ resultBytes: Uint8Array; actualSpendBaseUnits: string }>>;
}>;

export interface AdapterOperationHandler {
  readonly operation: AdapterRequest["operation"];
  prepare(request: AdapterRequest, payload: Uint8Array, signal: AbortSignal): Promise<PreparedAdapterCall>;
}

export type ExternalSubmission = Readonly<{
  transactionHash: `0x${string}`;
  nonce: string;
}>;

type JournalEntry =
  | { state: "RESERVED"; canonicalRequestHash: `0x${string}`; submissions: readonly ExternalSubmission[] }
  | { state: "COMPLETED"; canonicalRequestHash: `0x${string}`; submissions: readonly ExternalSubmission[]; response: AdapterResponse }
  | { state: "AMBIGUOUS"; canonicalRequestHash: `0x${string}`; submissions: readonly ExternalSubmission[] };

export type ReservationDecision =
  | { status: "RESERVED" }
  | { status: "COMPLETED"; response: AdapterResponse }
  | { status: "AMBIGUOUS" }
  | { status: "CONFLICT" };

export interface MutationJournal {
  reserve(idempotencyKey: string, canonicalRequestHash: `0x${string}`): Promise<ReservationDecision>;
  recordSubmission(idempotencyKey: string, canonicalRequestHash: `0x${string}`, submission: ExternalSubmission): Promise<void>;
  submissions(idempotencyKey: string, canonicalRequestHash: `0x${string}`): Promise<readonly ExternalSubmission[]>;
  complete(idempotencyKey: string, canonicalRequestHash: `0x${string}`, response: AdapterResponse): Promise<void>;
  markAmbiguous(idempotencyKey: string, canonicalRequestHash: `0x${string}`): Promise<void>;
}

export class InMemoryMutationJournal implements MutationJournal {
  readonly #entries = new Map<string, JournalEntry>();

  async reserve(idempotencyKey: string, canonicalRequestHash: `0x${string}`): Promise<ReservationDecision> {
    const existing = this.#entries.get(idempotencyKey);
    if (existing === undefined) {
      this.#entries.set(idempotencyKey, { state: "RESERVED", canonicalRequestHash, submissions: [] });
      return { status: "RESERVED" };
    }
    if (existing.canonicalRequestHash !== canonicalRequestHash) return { status: "CONFLICT" };
    if (existing.state === "COMPLETED") return { status: "COMPLETED", response: existing.response };
    return { status: "AMBIGUOUS" };
  }

  async recordSubmission(idempotencyKey: string, canonicalRequestHash: `0x${string}`, submission: ExternalSubmission): Promise<void> {
    const existing = this.#entries.get(idempotencyKey);
    if (existing?.state !== "RESERVED" || existing.canonicalRequestHash !== canonicalRequestHash) throw new Error("JOURNAL_STATE_INVALID");
    const duplicate = existing.submissions.find((item) => item.transactionHash === submission.transactionHash);
    if (duplicate !== undefined) {
      if (duplicate.nonce !== submission.nonce) throw new Error("SUBMISSION_NONCE_CONFLICT");
      return;
    }
    this.#entries.set(idempotencyKey, { ...existing, submissions: [...existing.submissions, submission] });
  }

  async submissions(idempotencyKey: string, canonicalRequestHash: `0x${string}`): Promise<readonly ExternalSubmission[]> {
    const existing = this.#entries.get(idempotencyKey);
    if (existing === undefined || existing.canonicalRequestHash !== canonicalRequestHash) throw new Error("JOURNAL_STATE_INVALID");
    return existing.submissions;
  }

  async complete(idempotencyKey: string, canonicalRequestHash: `0x${string}`, response: AdapterResponse): Promise<void> {
    const existing = this.#entries.get(idempotencyKey);
    if (existing?.state !== "RESERVED" || existing.canonicalRequestHash !== canonicalRequestHash) throw new Error("JOURNAL_STATE_INVALID");
    this.#entries.set(idempotencyKey, { state: "COMPLETED", canonicalRequestHash, submissions: existing.submissions, response });
  }

  async markAmbiguous(idempotencyKey: string, canonicalRequestHash: `0x${string}`): Promise<void> {
    const existing = this.#entries.get(idempotencyKey);
    if (existing?.canonicalRequestHash !== canonicalRequestHash) throw new Error("JOURNAL_STATE_INVALID");
    this.#entries.set(idempotencyKey, { state: "AMBIGUOUS", canonicalRequestHash, submissions: existing.submissions });
  }
}

function journalDirectoryName(idempotencyKey: string): string {
  return createHash("sha256").update(idempotencyKey).digest("hex");
}

function parseJournalEntry(value: unknown): JournalEntry | null {
  if (typeof value !== "object" || value === null || !("state" in value) || !("canonicalRequestHash" in value)) return null;
  const candidate = value as Record<string, unknown>;
  const parsedHash = HashHexSchema.safeParse(candidate.canonicalRequestHash);
  if (!parsedHash.success) return null;
  const canonicalRequestHash = parsedHash.data as `0x${string}`;
  const submissions = z.array(z.object({ transactionHash: HashHexSchema, nonce: z.string().regex(/^(0|[1-9][0-9]*)$/) }).strict()).safeParse(candidate.submissions);
  if (!submissions.success) return null;
  const typedSubmissions = submissions.data as ExternalSubmission[];
  if (new Set(typedSubmissions.map((submission) => submission.transactionHash)).size !== typedSubmissions.length) return null;
  if (candidate.state === "RESERVED" || candidate.state === "AMBIGUOUS") return { state: candidate.state, canonicalRequestHash, submissions: typedSubmissions };
  if (candidate.state !== "COMPLETED") return null;
  const parsedResponse = AdapterResponseSchema.safeParse(candidate.response);
  return parsedResponse.success ? { state: "COMPLETED", canonicalRequestHash, submissions: typedSubmissions, response: parsedResponse.data } : null;
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class FileMutationJournal implements MutationJournal {
  readonly #rootDirectory: string;

  constructor(rootDirectory: string) {
    if (rootDirectory.length === 0) throw new Error("JOURNAL_ROOT_REQUIRED");
    this.#rootDirectory = rootDirectory;
  }

  async #entryDirectory(idempotencyKey: string): Promise<{ path: string; created: boolean }> {
    await mkdir(this.#rootDirectory, { recursive: true, mode: 0o700 });
    const path = join(this.#rootDirectory, journalDirectoryName(idempotencyKey));
    try {
      await mkdir(path, { mode: 0o700 });
      await syncDirectory(this.#rootDirectory);
      return { path, created: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await lstat(path);
      if (!existing.isDirectory()) throw new Error("JOURNAL_ENTRY_INVALID");
      return { path, created: false };
    }
  }

  async #readEntry(entryDirectory: string): Promise<JournalEntry | null> {
    try {
      return parseJournalEntry(JSON.parse(await readFile(join(entryDirectory, "state.json"), "utf8")));
    } catch {
      return null;
    }
  }

  async #writeEntry(entryDirectory: string, entry: JournalEntry): Promise<void> {
    const temporaryPath = join(entryDirectory, `state.${randomUUID()}.tmp`);
    const finalPath = join(entryDirectory, "state.json");
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(entry)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, finalPath);
    await syncDirectory(entryDirectory);
  }

  async reserve(idempotencyKey: string, canonicalRequestHash: `0x${string}`): Promise<ReservationDecision> {
    const entryDirectory = await this.#entryDirectory(idempotencyKey);
    if (entryDirectory.created) {
      await this.#writeEntry(entryDirectory.path, { state: "RESERVED", canonicalRequestHash, submissions: [] });
      return { status: "RESERVED" };
    }
    const existing = await this.#readEntry(entryDirectory.path);
    if (existing === null) return { status: "AMBIGUOUS" };
    if (existing.canonicalRequestHash !== canonicalRequestHash) return { status: "CONFLICT" };
    if (existing.state === "RESERVED" || existing.state === "AMBIGUOUS") return { status: "AMBIGUOUS" };
    return { status: "COMPLETED", response: existing.response };
  }

  async recordSubmission(idempotencyKey: string, canonicalRequestHash: `0x${string}`, submission: ExternalSubmission): Promise<void> {
    const entryDirectory = join(this.#rootDirectory, journalDirectoryName(idempotencyKey));
    const existing = await this.#readEntry(entryDirectory);
    if (existing?.state !== "RESERVED" || existing.canonicalRequestHash !== canonicalRequestHash) throw new Error("JOURNAL_STATE_INVALID");
    const duplicate = existing.submissions.find((item) => item.transactionHash === submission.transactionHash);
    if (duplicate !== undefined) {
      if (duplicate.nonce !== submission.nonce) throw new Error("SUBMISSION_NONCE_CONFLICT");
      return;
    }
    await this.#writeEntry(entryDirectory, { ...existing, submissions: [...existing.submissions, submission] });
  }

  async submissions(idempotencyKey: string, canonicalRequestHash: `0x${string}`): Promise<readonly ExternalSubmission[]> {
    const entryDirectory = join(this.#rootDirectory, journalDirectoryName(idempotencyKey));
    const existing = await this.#readEntry(entryDirectory);
    if (existing === null || existing.canonicalRequestHash !== canonicalRequestHash) throw new Error("JOURNAL_STATE_INVALID");
    return existing.submissions;
  }

  async complete(idempotencyKey: string, canonicalRequestHash: `0x${string}`, response: AdapterResponse): Promise<void> {
    const entryDirectory = join(this.#rootDirectory, journalDirectoryName(idempotencyKey));
    const existing = await this.#readEntry(entryDirectory);
    if (existing?.state !== "RESERVED" || existing.canonicalRequestHash !== canonicalRequestHash) throw new Error("JOURNAL_STATE_INVALID");
    await this.#writeEntry(entryDirectory, { state: "COMPLETED", canonicalRequestHash, submissions: existing.submissions, response });
  }

  async markAmbiguous(idempotencyKey: string, canonicalRequestHash: `0x${string}`): Promise<void> {
    const entryDirectory = join(this.#rootDirectory, journalDirectoryName(idempotencyKey));
    const existing = await this.#readEntry(entryDirectory);
    if (existing?.canonicalRequestHash !== canonicalRequestHash) throw new Error("JOURNAL_STATE_INVALID");
    await this.#writeEntry(entryDirectory, { state: "AMBIGUOUS", canonicalRequestHash, submissions: existing.submissions });
  }
}

export type SubmissionResolution = Readonly<{
  transactionHash: `0x${string}`;
  nonce: string;
  status: "PENDING" | "CONFIRMED" | "DROPPED";
}>;

export type ReconciliationDecision =
  | { status: "SETTLED"; transactionHashes: readonly `0x${string}`[] }
  | { status: "PARTIALLY_SETTLED"; transactionHashes: readonly `0x${string}`[] }
  | { status: "UNRESOLVED" }
  | { status: "SAFE_TO_RETRY" }
  | { status: "INCONSISTENT" };

export function reconcileSubmissions(submissions: readonly ExternalSubmission[], resolutions: readonly SubmissionResolution[]): ReconciliationDecision {
  if (submissions.length === 0) return { status: "SAFE_TO_RETRY" };
  const byHash = new Map(resolutions.map((resolution) => [resolution.transactionHash, resolution]));
  if (byHash.size !== resolutions.length || resolutions.some((resolution) => !submissions.some((submission) => submission.transactionHash === resolution.transactionHash))) return { status: "INCONSISTENT" };
  const matched = submissions.map((submission) => byHash.get(submission.transactionHash));
  if (matched.some((resolution) => resolution === undefined)) return { status: "UNRESOLVED" };
  if (matched.some((resolution, index) => resolution!.nonce !== submissions[index]!.nonce)) return { status: "INCONSISTENT" };
  if (matched.some((resolution) => resolution!.status === "PENDING")) return { status: "UNRESOLVED" };
  const nonceGroups = new Map<string, SubmissionResolution[]>();
  for (const resolution of matched as SubmissionResolution[]) nonceGroups.set(resolution.nonce, [...(nonceGroups.get(resolution.nonce) ?? []), resolution]);
  const confirmed: `0x${string}`[] = [];
  for (const group of nonceGroups.values()) {
    const mined = group.filter((resolution) => resolution.status === "CONFIRMED");
    if (mined.length > 1) return { status: "INCONSISTENT" };
    if (mined.length === 1) confirmed.push(mined[0]!.transactionHash);
  }
  if (confirmed.length === 0) return { status: "SAFE_TO_RETRY" };
  if (confirmed.length === nonceGroups.size) return { status: "SETTLED", transactionHashes: confirmed };
  return { status: "PARTIALLY_SETTLED", transactionHashes: confirmed };
}

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

export function hashAdapterBytes(bytes: Uint8Array): `0x${string}` {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

function decodePayload(payloadBase64: string): Uint8Array {
  if (!BASE64_PATTERN.test(payloadBase64)) throw new Error("INVALID_BASE64");
  const bytes = Buffer.from(payloadBase64, "base64");
  if (bytes.byteLength > MAX_PAYLOAD_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
  if (bytes.toString("base64") !== payloadBase64) throw new Error("NON_CANONICAL_BASE64");
  return bytes;
}

function failure(requestId: string, code: Extract<AdapterResponse, { ok: false }>["code"], retryable = false): AdapterResponse {
  return { ok: false, requestId, code, retryable };
}

function safeRequestId(input: unknown): string {
  if (typeof input === "object" && input !== null && "requestId" in input && typeof input.requestId === "string" && /^[a-z][a-z0-9-]{0,127}$/.test(input.requestId)) return input.requestId;
  return "invalid-request";
}

export type AdapterProcessSpec = Readonly<{
  executablePath: string;
  arguments: readonly string[];
  workingDirectory: string;
  environment: Readonly<Record<string, string>>;
  timeoutMs: number;
  maximumResponseBytes?: number;
}>;

function validProcessSpec(spec: AdapterProcessSpec): boolean {
  return (
    isAbsolute(spec.executablePath) &&
    isAbsolute(spec.workingDirectory) &&
    spec.arguments.length <= 32 &&
    spec.arguments.every((argument) => argument.length <= 1_024 && !argument.includes("\0")) &&
    Number.isInteger(spec.timeoutMs) && spec.timeoutMs >= 100 && spec.timeoutMs <= 120_000 &&
    (spec.maximumResponseBytes === undefined || (Number.isInteger(spec.maximumResponseBytes) && spec.maximumResponseBytes >= 1_024 && spec.maximumResponseBytes <= 3_000_000)) &&
    Object.entries(spec.environment).every(([key, value]) => /^[A-Z][A-Z0-9_]{0,127}$/.test(key) && value.length <= 16_384 && !value.includes("\0"))
  );
}

export async function runAdapterProcess(input: unknown, spec: AdapterProcessSpec, signal: AbortSignal): Promise<AdapterResponse> {
  const parsed = AdapterRequestSchema.safeParse(input);
  if (!parsed.success || !validProcessSpec(spec)) return failure(safeRequestId(input), "INVALID_REQUEST");
  const request = parsed.data;
  const mutation = isMutationOperation(request.operation);
  if (signal.aborted) return failure(request.requestId, "DEPENDENCY_UNAVAILABLE", true);

  return await new Promise<AdapterResponse>((resolve) => {
    const maximumResponseBytes = spec.maximumResponseBytes ?? 2_800_000;
    const child = spawn(spec.executablePath, [...spec.arguments], {
      cwd: spec.workingDirectory,
      env: { ...spec.environment },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputExceeded = false;
    let inputFailed = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const finish = (response: AdapterResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abortListener);
      resolve(response);
    };
    const uncertainFailure = (timeout: boolean): AdapterResponse => mutation
      ? failure(request.requestId, "AMBIGUOUS_SUBMISSION")
      : failure(request.requestId, timeout ? "DEPENDENCY_TIMEOUT" : "DEPENDENCY_UNAVAILABLE", true);
    const terminate = (): void => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, spec.timeoutMs);
    const abortListener = (): void => {
      aborted = true;
      terminate();
    };
    signal.addEventListener("abort", abortListener, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > maximumResponseBytes) {
        outputExceeded = true;
        terminate();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > 16_384) {
        outputExceeded = true;
        terminate();
      }
    });
    child.on("error", () => finish(failure(request.requestId, "DEPENDENCY_UNAVAILABLE", true)));
    child.on("exit", (code) => {
      if (timedOut || aborted) return finish(uncertainFailure(true));
      if (inputFailed || outputExceeded || code !== 0) return finish(uncertainFailure(false));
      try {
        const response = AdapterResponseSchema.parse(JSON.parse(Buffer.concat(stdout).toString("utf8")));
        if (response.requestId !== request.requestId) return finish(uncertainFailure(false));
        if (response.ok) {
          const resultBytes = decodePayload(response.resultBase64);
          if (hashAdapterBytes(resultBytes) !== response.resultHash) return finish(uncertainFailure(false));
        }
        return finish(response);
      } catch {
        return finish(uncertainFailure(false));
      }
    });
    child.stdin.on("error", () => {
      inputFailed = true;
      terminate();
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

const AdapterChildFrameSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("SUBMITTED"), requestId: z.string(), transactionHash: HashHexSchema, nonce: z.string().regex(/^(0|[1-9][0-9]*)$/) }).strict(),
  z.object({ kind: z.literal("RESULT"), response: AdapterResponseSchema }).strict(),
]);

export async function runFramedAdapterProcess(input: unknown, spec: AdapterProcessSpec, journal: MutationJournal, signal: AbortSignal): Promise<AdapterResponse> {
  const parsed = AdapterRequestSchema.safeParse(input);
  if (!parsed.success || !validProcessSpec(spec)) return failure(safeRequestId(input), "INVALID_REQUEST");
  const request = parsed.data;
  const mutation = isMutationOperation(request.operation);
  if (signal.aborted) return failure(request.requestId, "DEPENDENCY_UNAVAILABLE", true);

  return await new Promise<AdapterResponse>((resolve) => {
    const child = spawn(spec.executablePath, [...spec.arguments], { cwd: spec.workingDirectory, env: { ...spec.environment }, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    const maximumResponseBytes = spec.maximumResponseBytes ?? 2_800_000;
    let buffered = "";
    let receivedBytes = 0;
    let stderrBytes = 0;
    let finalResponse: AdapterResponse | undefined;
    let invalid = false;
    let timedOut = false;
    let settled = false;
    let processing = Promise.resolve();

    const uncertain = (timeout = false): AdapterResponse => mutation
      ? failure(request.requestId, "AMBIGUOUS_SUBMISSION")
      : failure(request.requestId, timeout ? "DEPENDENCY_TIMEOUT" : "DEPENDENCY_UNAVAILABLE", true);
    const terminate = (): void => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };
    const finish = (response: AdapterResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abortListener);
      resolve(response);
    };
    const rejectProtocol = (): void => { invalid = true; terminate(); };
    const handleLine = async (line: string): Promise<void> => {
      if (line.length === 0 || invalid) return;
      const frame = AdapterChildFrameSchema.safeParse(JSON.parse(line));
      if (!frame.success) return rejectProtocol();
      if (frame.data.kind === "SUBMITTED") {
        if (!mutation || frame.data.requestId !== request.requestId || finalResponse !== undefined) return rejectProtocol();
        try {
          await journal.recordSubmission(request.idempotencyKey!, request.canonicalRequestHash as `0x${string}`, {
            transactionHash: frame.data.transactionHash as `0x${string}`,
            nonce: frame.data.nonce,
          });
          child.stdin.write(`${JSON.stringify({ kind: "ACK", requestId: request.requestId, transactionHash: frame.data.transactionHash })}\n`);
        } catch {
          return rejectProtocol();
        }
        return;
      }
      if (finalResponse !== undefined || frame.data.response.requestId !== request.requestId) return rejectProtocol();
      if (frame.data.response.ok) {
        try {
          const resultBytes = decodePayload(frame.data.response.resultBase64);
          if (hashAdapterBytes(resultBytes) !== frame.data.response.resultHash) return rejectProtocol();
        } catch {
          return rejectProtocol();
        }
      }
      finalResponse = frame.data.response;
      child.stdin.end();
    };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, spec.timeoutMs);
    const abortListener = (): void => { timedOut = true; terminate(); };
    signal.addEventListener("abort", abortListener, { once: true });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      receivedBytes += Buffer.byteLength(chunk);
      if (receivedBytes > maximumResponseBytes) return rejectProtocol();
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) processing = processing.then(() => handleLine(line)).catch(rejectProtocol);
    });
    child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.byteLength; if (stderrBytes > 16_384) rejectProtocol(); });
    child.on("error", () => finish(failure(request.requestId, "DEPENDENCY_UNAVAILABLE", true)));
    child.on("exit", async (code) => {
      await processing;
      if (buffered.trim().length > 0 || invalid || code !== 0 || finalResponse === undefined) return finish(uncertain(timedOut));
      return finish(finalResponse);
    });
    child.stdin.on("error", rejectProtocol);
    child.stdin.write(`${JSON.stringify({ kind: "REQUEST", request })}\n`);
  });
}

export async function executeAdapterRequest(
  input: unknown,
  handler: AdapterOperationHandler,
  journal: MutationJournal,
  signal: AbortSignal,
  nowUnixMs = Date.now(),
): Promise<AdapterResponse> {
  const parsed = AdapterRequestSchema.safeParse(input);
  if (!parsed.success) return failure(safeRequestId(input), "INVALID_REQUEST");
  const request = parsed.data;
  if (request.operation !== handler.operation) return failure(request.requestId, "INVALID_REQUEST");

  let payload: Uint8Array;
  try {
    payload = decodePayload(request.payloadBase64);
  } catch {
    return failure(request.requestId, "INVALID_REQUEST");
  }
  if (hashAdapterBytes(payload) !== request.canonicalRequestHash) return failure(request.requestId, "INVALID_REQUEST");

  const mutationOperation = isMutationOperation(request.operation) ? request.operation : null;
  const mutation = mutationOperation !== null;
  const canonicalRequestHash = request.canonicalRequestHash as `0x${string}`;
  if (mutationOperation !== null) {
    try {
      const approval = { ...request.approval!, canonicalRequestHash: request.approval!.canonicalRequestHash as `0x${string}` };
      assertWriteApproval({ idempotencyKey: request.idempotencyKey!, canonicalRequestHash, approval }, mutationOperation, requiredScope(mutationOperation, canonicalRequestHash), request.network, nowUnixMs);
    } catch {
      return failure(request.requestId, "EXTERNAL_WRITE_NOT_APPROVED");
    }
  }

  let prepared: PreparedAdapterCall;
  try {
    prepared = await handler.prepare(request, payload, signal);
  } catch {
    return failure(request.requestId, "DEPENDENCY_UNAVAILABLE", true);
  }
  if (!/^(0|[1-9][0-9]*)$/.test(prepared.quotedMaximumSpendBaseUnits)) return failure(request.requestId, "INVALID_REQUEST");
  if (!mutation && prepared.quotedMaximumSpendBaseUnits !== "0") return failure(request.requestId, "INVALID_REQUEST");
  if (mutation && BigInt(prepared.quotedMaximumSpendBaseUnits) > BigInt(request.approval!.maximumSpendBaseUnits)) return failure(request.requestId, "SPEND_CAP_EXCEEDED");

  let idempotencyKey: string | undefined;
  if (mutation) {
    idempotencyKey = request.idempotencyKey!;
    let reservation: ReservationDecision;
    try {
      reservation = await journal.reserve(idempotencyKey, canonicalRequestHash);
    } catch {
      return failure(request.requestId, "AMBIGUOUS_SUBMISSION");
    }
    if (reservation.status === "COMPLETED") return reservation.response;
    if (reservation.status === "AMBIGUOUS") return failure(request.requestId, "AMBIGUOUS_SUBMISSION");
    if (reservation.status === "CONFLICT") return failure(request.requestId, "INVALID_REQUEST");
  }

  try {
    const result = await prepared.execute(signal);
    if (!/^(0|[1-9][0-9]*)$/.test(result.actualSpendBaseUnits)) throw new Error("INVALID_ACTUAL_SPEND");
    if (BigInt(result.actualSpendBaseUnits) > BigInt(prepared.quotedMaximumSpendBaseUnits)) throw new Error("QUOTE_EXCEEDED");
    const response = AdapterResponseSchema.parse({ ok: true, requestId: request.requestId, resultHash: hashAdapterBytes(result.resultBytes), resultBase64: Buffer.from(result.resultBytes).toString("base64") });
    if (mutation) await journal.complete(idempotencyKey!, canonicalRequestHash, response);
    return response;
  } catch {
    if (mutation) {
      try {
        await journal.markAmbiguous(idempotencyKey!, canonicalRequestHash);
      } catch {
        // The outward result and the journal are both uncertain; never make this retryable.
      }
      return failure(request.requestId, "AMBIGUOUS_SUBMISSION");
    }
    return failure(request.requestId, "DEPENDENCY_UNAVAILABLE", true);
  }
}

export type ExternalWriteApproval = Readonly<{
  approvalId: string;
  action: "COMPUTE_PROBE" | "STORAGE_UPLOAD" | "CHAIN_ANCHOR";
  scope: string;
  network: string;
  canonicalRequestHash: `0x${string}`;
  maximumSpendBaseUnits: string;
  expiresAtUnixMs: number;
}>;

export type MutationContext = Readonly<{
  idempotencyKey: string;
  canonicalRequestHash: `0x${string}`;
  approval: ExternalWriteApproval;
}>;

export type ProviderCandidate = Readonly<{
  providerId: string;
  requestHash: `0x${string}`;
  responseHash: `0x${string}`;
  transitionIds: readonly string[];
  provenance: Readonly<Record<string, string>>;
}>;

export interface ComputePort {
  listEligibleProviders(signal: AbortSignal): Promise<readonly string[]>;
  runTrajectoryProbe(requestBytes: Uint8Array, context: MutationContext, signal: AbortSignal): Promise<ProviderCandidate>;
  verifyCandidate(candidate: ProviderCandidate, expectedRequestHash: `0x${string}`): Promise<boolean>;
}

export interface StoragePort {
  computeRoot(bytes: Uint8Array): Promise<`0x${string}`>;
  upload(bytes: Uint8Array, context: MutationContext, signal: AbortSignal): Promise<{ root: `0x${string}`; transactionId: string }>;
  download(root: `0x${string}`, signal: AbortSignal): Promise<{ bytes: Uint8Array; proofValid: boolean }>;
}

export interface ChainPort {
  readAnchor(submitter: `0x${string}`, bundleRoot: `0x${string}`, signal: AbortSignal): Promise<AnchorRecord | null>;
  anchor(record: AnchorInput, context: MutationContext, signal: AbortSignal): Promise<{ transactionHash: `0x${string}` }>;
}

export type AnchorInput = Readonly<{
  bundleRoot: `0x${string}`;
  policyHash: `0x${string}`;
  graphHash: `0x${string}`;
  maximumLossBaseUnits: string;
  engineVersionHash: `0x${string}`;
  status: 1 | 2;
}>;

export type AnchorRecord = AnchorInput & Readonly<{
  submitter: `0x${string}`;
  anchoredAtUnixSeconds: number;
}>;

export type CandidateDecision =
  | { accepted: true; candidate: ProviderCandidate }
  | { accepted: false; code: "EXTERNAL_WRITE_NOT_APPROVED" | "DEPENDENCY_UNAVAILABLE" | "CONTEXT_MISMATCH" | "PROVIDER_EVIDENCE_INVALID" | "GRAPH_EXTERNAL_ACTION" };

export async function collectVerifiedCandidate(
  port: ComputePort,
  requestBytes: Uint8Array,
  expectedRequestHash: `0x${string}`,
  context: MutationContext,
  network: string,
  allowedActionIds: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<CandidateDecision> {
  try {
    assertWriteApproval(context, "COMPUTE_PROBE", `compute:${expectedRequestHash}`, network);
  } catch {
    return { accepted: false, code: "EXTERNAL_WRITE_NOT_APPROVED" };
  }
  let candidate: ProviderCandidate;
  try {
    candidate = await port.runTrajectoryProbe(requestBytes, context, signal);
  } catch {
    return { accepted: false, code: "DEPENDENCY_UNAVAILABLE" };
  }
  if (candidate.requestHash !== expectedRequestHash) return { accepted: false, code: "CONTEXT_MISMATCH" };
  if (candidate.transitionIds.some((transitionId) => !allowedActionIds.has(transitionId))) return { accepted: false, code: "GRAPH_EXTERNAL_ACTION" };
  try {
    if (!(await port.verifyCandidate(candidate, expectedRequestHash))) return { accepted: false, code: "PROVIDER_EVIDENCE_INVALID" };
  } catch {
    return { accepted: false, code: "PROVIDER_EVIDENCE_INVALID" };
  }
  return { accepted: true, candidate };
}

export function assertWriteApproval(context: MutationContext, action: ExternalWriteApproval["action"], scope: string, network: string, nowUnixMs = Date.now()): void {
  if (context.idempotencyKey.length < 16 || context.idempotencyKey.length > 128) throw new Error("IDEMPOTENCY_KEY_INVALID");
  if (!/^0x[0-9a-f]{64}$/.test(context.canonicalRequestHash)) throw new Error("CANONICAL_REQUEST_HASH_INVALID");
  if (!/^(0|[1-9][0-9]*)$/.test(context.approval.maximumSpendBaseUnits)) throw new Error("MAXIMUM_SPEND_INVALID");
  if (
    context.approval.action !== action ||
    context.approval.scope !== scope ||
    context.approval.network !== network ||
    context.approval.canonicalRequestHash !== context.canonicalRequestHash ||
    context.approval.expiresAtUnixMs <= nowUnixMs
  ) {
    throw new Error("EXTERNAL_WRITE_NOT_APPROVED");
  }
}
