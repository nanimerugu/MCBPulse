/**
 * A fixed-window rate limiter, in process memory.
 *
 * HONEST ABOUT WHAT IT IS: this counts per Node process. Behind two app
 * instances a caller gets two buckets, and every count resets on deploy. It
 * raises the cost of a brute-force attempt from "free" to "slow" and no
 * further. A real deployment needs Redis, and the interface here is shaped
 * so that swap is a change to this file only.
 *
 * Extracted from the Phase 3 public-enquiry form, which had the only copy.
 * Phase 12 needs the same thing on the login form, and two implementations
 * of "have they done this too often" is one more than a system should have.
 */

export interface RateLimitRule {
  /** How many attempts are allowed in a window. */
  max: number;
  windowMs: number;
}

export interface RateLimitResult {
  limited: boolean;
  /** Attempts left after this one; 0 when limited. */
  remaining: number;
  /** When the window frees up, for a Retry-After or a message. */
  resetAt: number;
}

const buckets = new Map<string, number[]>();

/** Keeps the map from growing without bound in a long-lived process. */
const MAX_KEYS = 20_000;

export function checkRateLimit(key: string, rule: RateLimitRule, now = Date.now()): RateLimitResult {
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < rule.windowMs);

  if (recent.length >= rule.max) {
    buckets.set(key, recent);
    const oldest = recent[0] ?? now;
    return { limited: true, remaining: 0, resetAt: oldest + rule.windowMs };
  }

  recent.push(now);
  buckets.set(key, recent);

  if (buckets.size > MAX_KEYS) {
    for (const [k, v] of buckets) if (v.every((t) => now - t >= rule.windowMs)) buckets.delete(k);
  }

  return { limited: false, remaining: rule.max - recent.length, resetAt: now + rule.windowMs };
}

/** Forget a key — called after a SUCCESSFUL login so one good sign-in clears the count. */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

/** Test seam. Never call this from application code. */
export function resetAllRateLimits(): void {
  buckets.clear();
}

export const LOGIN_RULE: RateLimitRule = { max: 8, windowMs: 10 * 60_000 };
export const PUBLIC_FORM_RULE: RateLimitRule = { max: 5, windowMs: 60_000 };

/**
 * The client IP, from the proxy headers a deployment actually sets.
 *
 * These headers are attacker-controlled unless a trusted proxy overwrites
 * them, so this is a throttling key, never an identity. Nothing in the
 * system authorises anything based on it.
 */
export function clientIpFrom(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}

export function retryAfterSeconds(result: RateLimitResult, now = Date.now()): number {
  return Math.max(1, Math.ceil((result.resetAt - now) / 1000));
}
