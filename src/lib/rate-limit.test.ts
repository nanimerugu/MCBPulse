import { beforeEach, describe, expect, it } from "vitest";
import {
  checkRateLimit,
  clearRateLimit,
  clientIpFrom,
  LOGIN_RULE,
  resetAllRateLimits,
  retryAfterSeconds,
} from "@/lib/rate-limit";

const RULE = { max: 3, windowMs: 60_000 };

beforeEach(() => resetAllRateLimits());

describe("checkRateLimit", () => {
  it("allows up to the limit, then refuses", () => {
    const t = 1_000_000;
    expect(checkRateLimit("a", RULE, t).limited).toBe(false);
    expect(checkRateLimit("a", RULE, t).limited).toBe(false);
    expect(checkRateLimit("a", RULE, t).limited).toBe(false);
    expect(checkRateLimit("a", RULE, t).limited).toBe(true);
  });

  it("counts down the remaining attempts", () => {
    const t = 1_000_000;
    expect(checkRateLimit("b", RULE, t).remaining).toBe(2);
    expect(checkRateLimit("b", RULE, t).remaining).toBe(1);
    expect(checkRateLimit("b", RULE, t).remaining).toBe(0);
  });

  it("keeps separate counts per key", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("c", RULE, t);
    expect(checkRateLimit("c", RULE, t).limited).toBe(true);
    expect(checkRateLimit("d", RULE, t).limited).toBe(false);
  });

  it("frees up once the window has passed", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("e", RULE, t);
    expect(checkRateLimit("e", RULE, t + 59_000).limited).toBe(true);
    expect(checkRateLimit("e", RULE, t + 61_000).limited).toBe(false);
  });

  it("does not extend the window by refusing — a blocked caller still gets out", () => {
    // A limiter that re-stamps on a refused attempt locks someone out
    // forever if they keep retrying. This one must not.
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("f", RULE, t);
    for (let i = 0; i < 20; i++) checkRateLimit("f", RULE, t + 30_000);
    expect(checkRateLimit("f", RULE, t + 61_000).limited).toBe(false);
  });

  it("reports when the window frees up", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("g", RULE, t);
    const r = checkRateLimit("g", RULE, t + 10_000);
    expect(r.resetAt).toBe(t + 60_000);
    expect(retryAfterSeconds(r, t + 10_000)).toBe(50);
  });
});

describe("clearRateLimit", () => {
  it("forgets a key, so a successful sign-in resets the count", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("h", RULE, t);
    expect(checkRateLimit("h", RULE, t).limited).toBe(true);
    clearRateLimit("h");
    expect(checkRateLimit("h", RULE, t).limited).toBe(false);
  });
});

describe("clientIpFrom", () => {
  const headers = (map: Record<string, string>) => ({ get: (n: string) => map[n] ?? null });

  it("takes the first entry of x-forwarded-for", () => {
    expect(clientIpFrom(headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip, then to a constant", () => {
    expect(clientIpFrom(headers({ "x-real-ip": "203.0.113.5" }))).toBe("203.0.113.5");
    expect(clientIpFrom(headers({}))).toBe("unknown");
  });

  it("trims whitespace", () => {
    expect(clientIpFrom(headers({ "x-forwarded-for": "  203.0.113.9  , 10.0.0.1" }))).toBe("203.0.113.9");
  });
});

describe("LOGIN_RULE", () => {
  it("is tight enough to matter and loose enough for a real person", () => {
    expect(LOGIN_RULE.max).toBeLessThanOrEqual(10);
    expect(LOGIN_RULE.windowMs).toBeGreaterThanOrEqual(5 * 60_000);
  });
});
