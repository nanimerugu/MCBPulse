import { describe, expect, it } from "vitest";
import {
  checkNewPassword,
  generateToken,
  hashToken,
  looksLikeToken,
  maskEmail,
  PASSWORD_MAX_BYTES,
  sessionPredatesPasswordChange,
  tokenState,
} from "@/lib/auth-tokens";

describe("generateToken", () => {
  it("makes a 256-bit url-safe token and stores only its hash", () => {
    const { token, tokenHash } = generateToken();
    expect(looksLikeToken(token)).toBe(true);
    expect(tokenHash).toBe(hashToken(token));
    expect(tokenHash).not.toContain(token);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateToken().token));
    expect(seen.size).toBe(200);
  });
});

describe("looksLikeToken", () => {
  it("rejects a link an email client has truncated or mangled", () => {
    const { token } = generateToken();
    expect(looksLikeToken(token.slice(0, 40))).toBe(false);
    expect(looksLikeToken(`${token}=`)).toBe(false);
    expect(looksLikeToken("../../etc/passwd")).toBe(false);
    expect(looksLikeToken("")).toBe(false);
  });
});

describe("tokenState", () => {
  const now = new Date("2026-09-15T10:00:00Z");
  const later = new Date("2026-09-15T11:00:00Z");

  it("is usable only when unused, unrevoked and unexpired", () => {
    expect(tokenState({ usedAt: null, revokedAt: null, expiresAt: later }, now)).toBe("usable");
  });

  it("reports why it can't be used, most decisive reason first", () => {
    expect(tokenState({ usedAt: now, revokedAt: now, expiresAt: now }, now)).toBe("used");
    expect(tokenState({ usedAt: null, revokedAt: now, expiresAt: later }, now)).toBe("revoked");
    expect(tokenState({ usedAt: null, revokedAt: null, expiresAt: now }, now)).toBe("expired");
  });
});

describe("checkNewPassword", () => {
  const who = { email: "lakshmi.iyer@example.com", name: "Lakshmi Iyer" };

  it("accepts a reasonable password", () => {
    expect(checkNewPassword("river-lantern-47", "river-lantern-47", who)).toEqual({ ok: true });
  });

  it("requires length, and a matching confirmation", () => {
    expect(checkNewPassword("short1!", "short1!", who).ok).toBe(false);
    expect(checkNewPassword("river-lantern-47", "river-lantern-48", who).ok).toBe(false);
  });

  it("refuses more than bcrypt would actually read", () => {
    const long = "a1".repeat(PASSWORD_MAX_BYTES);
    expect(checkNewPassword(long, long, who).ok).toBe(false);
    // Multi-byte characters count as bytes, not characters.
    const emoji = "🙂".repeat(19); // 76 bytes, 38 UTF-16 units
    expect(checkNewPassword(emoji, emoji, who).ok).toBe(false);
  });

  it("refuses the obvious, including this system's own demo password", () => {
    expect(checkNewPassword("ChangeMe!123", "ChangeMe!123", who).ok).toBe(false);
    expect(checkNewPassword("password123", "password123", who).ok).toBe(false);
    expect(checkNewPassword("aaaaaaaaaaaa", "aaaaaaaaaaaa", who).ok).toBe(false);
  });

  it("refuses a password built from the person's own email or name", () => {
    expect(checkNewPassword("lakshmi.iyer2026", "lakshmi.iyer2026", who).ok).toBe(false);
    expect(checkNewPassword("Lakshmi@school1", "Lakshmi@school1", who).ok).toBe(false);
  });
});

describe("maskEmail", () => {
  it("keeps the first letter and the domain", () => {
    expect(maskEmail("lakshmi.iyer@example.com")).toBe("l••••••••@example.com");
    expect(maskEmail("ab@x.in")).toBe("a•••@x.in");
    expect(maskEmail("not-an-email")).toBe("•••");
  });
});

describe("sessionPredatesPasswordChange", () => {
  const changed = new Date("2026-09-15T10:00:00Z");
  const sec = (d: string) => Math.floor(new Date(d).getTime() / 1000);

  it("kills a session signed in before a reset", () => {
    expect(sessionPredatesPasswordChange(sec("2026-09-15T09:59:59Z"), changed)).toBe(true);
  });

  it("keeps a session signed in after it (or in the same second)", () => {
    expect(sessionPredatesPasswordChange(sec("2026-09-15T10:00:00Z"), changed)).toBe(false);
    expect(sessionPredatesPasswordChange(sec("2026-09-15T10:05:00Z"), changed)).toBe(false);
  });

  it("signs nobody out just because the check was introduced", () => {
    // Sessions from before authTime existed have none; that only matters once
    // the password has actually changed.
    expect(sessionPredatesPasswordChange(undefined, null)).toBe(false);
    expect(sessionPredatesPasswordChange(undefined, changed)).toBe(true);
  });
});
