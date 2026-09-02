/**
 * Durable storage for API state.
 *
 * The API previously held compilations, runs and evidence in memory, so a
 * restart silently lost them and `GET /v1/runs/{id}` began returning 404 for
 * work that had genuinely happened. Records are now written to disk with
 * write-then-rename, so a crash mid-write leaves the previous record intact
 * rather than a truncated one.
 *
 * No dependencies: the workspace's zero-advisory graph is not worth a database
 * driver for records this small.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export interface Store {
  get(kind: string, id: string): unknown | null;
  put(kind: string, id: string, value: unknown): void;
  has(kind: string, id: string): boolean;
  count(kind: string): number;
}

/** Volatile store, used by tests that do not care about durability. */
export class MemoryStore implements Store {
  readonly #data = new Map<string, Map<string, unknown>>();

  #bucket(kind: string): Map<string, unknown> {
    const existing = this.#data.get(kind);
    if (existing !== undefined) return existing;
    const created = new Map<string, unknown>();
    this.#data.set(kind, created);
    return created;
  }

  get(kind: string, id: string): unknown | null { return this.#bucket(kind).get(id) ?? null; }
  put(kind: string, id: string, value: unknown): void { this.#bucket(kind).set(id, value); }
  has(kind: string, id: string): boolean { return this.#bucket(kind).has(id); }
  count(kind: string): number { return this.#bucket(kind).size; }
}

/** Ids reach the filesystem, so anything that is not a plain id is refused. */
function safeId(id: string): string {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) throw new Error("UNSAFE_RECORD_ID");
  return id;
}

export class FileStore implements Store {
  readonly #root: string;
  readonly #cache = new Map<string, unknown>();

  constructor(root: string) {
    this.#root = root;
    mkdirSync(root, { recursive: true });
  }

  #dir(kind: string): string {
    const dir = join(this.#root, safeId(kind));
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  #path(kind: string, id: string): string { return join(this.#dir(kind), `${safeId(id)}.json`); }

  get(kind: string, id: string): unknown | null {
    const key = `${kind}/${id}`;
    if (this.#cache.has(key)) return this.#cache.get(key) ?? null;
    try {
      const value = JSON.parse(readFileSync(this.#path(kind, id), "utf8")) as unknown;
      this.#cache.set(key, value);
      return value;
    } catch {
      return null;
    }
  }

  put(kind: string, id: string, value: unknown): void {
    const target = this.#path(kind, id);
    const temporary = `${target}.${process.pid}.tmp`;
    // Write to a sibling then rename: a reader never observes a partial record.
    writeFileSync(temporary, JSON.stringify(value), "utf8");
    try {
      renameSync(temporary, target);
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* the temp file is already gone */ }
      throw error;
    }
    this.#cache.set(`${kind}/${id}`, value);
  }

  has(kind: string, id: string): boolean { return this.get(kind, id) !== null; }

  count(kind: string): number {
    try {
      return readdirSync(this.#dir(kind)).filter((f) => f.endsWith(".json")).length;
    } catch {
      return 0;
    }
  }
}
