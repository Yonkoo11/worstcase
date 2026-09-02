/**
 * Authentication and rate limiting for the v1 surface.
 *
 * Both were declared in docs/openapi.yaml (UNAUTHORIZED, RATE_LIMITED) and
 * neither existed, so the contract promised protections the server did not
 * apply. No dependencies.
 */
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Bearer-token check.
 *
 * Keys are compared by SHA-256 digest under timingSafeEqual, so comparison time
 * does not vary with how much of the key matched, and the configured keys are
 * not held in a form that a heap dump hands straight to an attacker.
 */
export class ApiKeyAuth {
  readonly #digests: Buffer[];

  constructor(keys: readonly string[]) {
    this.#digests = keys.map((k) => k.trim()).filter((k) => k.length > 0).map((k) => createHash("sha256").update(k).digest());
  }

  /** True when no keys are configured, meaning the deployment is deliberately open. */
  get isOpen(): boolean { return this.#digests.length === 0; }

  accepts(authorizationHeader: string | undefined): boolean {
    if (this.isOpen) return true;
    const match = /^Bearer\s+(.+)$/i.exec((authorizationHeader ?? "").trim());
    if (match === null) return false;
    const presented = createHash("sha256").update(match[1] as string).digest();
    // Every configured key is compared, so the number of comparisons does not
    // reveal which key position matched.
    let ok = false;
    for (const digest of this.#digests) if (timingSafeEqual(presented, digest)) ok = true;
    return ok;
  }
}

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Fixed-window limiter keyed by caller.
 *
 * The search is bounded per request, but nothing stopped a caller issuing them
 * without limit. Windows are swept on read so an idle key does not retain memory.
 */
export class RateLimiter {
  readonly #hits = new Map<string, { count: number; windowStart: number }>();
  readonly #limit: number;
  readonly #windowMs: number;

  constructor(limit = 60, windowMs = 60_000) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  check(key: string, now = Date.now()): RateLimitDecision {
    const existing = this.#hits.get(key);
    if (existing === undefined || now - existing.windowStart >= this.#windowMs) {
      this.#hits.set(key, { count: 1, windowStart: now });
      this.#sweep(now);
      return { allowed: true };
    }
    if (existing.count >= this.#limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.windowStart + this.#windowMs - now) / 1000)) };
    }
    existing.count += 1;
    return { allowed: true };
  }

  #sweep(now: number): void {
    if (this.#hits.size < 1024) return;
    for (const [key, entry] of this.#hits) {
      if (now - entry.windowStart >= this.#windowMs) this.#hits.delete(key);
    }
  }
}

/**
 * Caller identity for rate limiting.
 *
 * `x-forwarded-for` is only trusted when the deployment says it sits behind a
 * proxy. Trusting it unconditionally lets any caller mint unlimited identities
 * by varying a header, which turns the limiter off.
 */
export function callerKey(remoteAddress: string | undefined, forwardedFor: string | undefined, trustProxy: boolean): string {
  if (trustProxy && forwardedFor !== undefined) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first !== undefined && first.length > 0) return first;
  }
  return remoteAddress ?? "unknown";
}
