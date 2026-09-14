import { createHash, randomBytes } from "node:crypto";

/**
 * One-time links for invitations and password resets — the pure half.
 *
 * A token is 32 random bytes (256 bits), so guessing one is not a strategy,
 * and only its SHA-256 is stored. SHA-256 rather than bcrypt is correct here
 * and would be wrong for a password: a password is low-entropy and needs a
 * slow hash to resist guessing; a 256-bit random token cannot be guessed at
 * any speed, and it must be looked up by hash, which a salted hash forbids.
 */

/** Long enough for a parent to get round to it; short enough that a forwarded email goes stale. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
/** A reset link is live for an hour — it is used now or not at all. */
export const RESET_TTL_MS = 60 * 60_000;

export function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Cheap shape check before any database work, so a malformed or truncated
 * link — a common result of email clients wrapping long URLs — fails fast
 * with a helpful message instead of a lookup.
 */
export function looksLikeToken(raw: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(raw);
}

export type TokenState = "usable" | "used" | "revoked" | "expired";

export function tokenState(t: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now: Date): TokenState {
  if (t.usedAt) return "used";
  if (t.revokedAt) return "revoked";
  if (t.expiresAt.getTime() <= now.getTime()) return "expired";
  return "usable";
}

/** What a person is told about a link that no longer works. Never whose it was. */
export const TOKEN_STATE_MESSAGES: Record<Exclude<TokenState, "usable">, string> = {
  used: "This link has already been used. If that wasn't you, ask the school office to reset your access.",
  revoked: "A newer link has been sent, which replaced this one. Use the most recent message.",
  expired: "This link has expired. Ask for a new one.",
};

/**
 * "l•••••@example.com" — enough for a person to recognise their own address
 * on a set-password page, not enough to read someone else's off a
 * shoulder-surfed screen.
 */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (!domain) return "•••";
  return `${local.slice(0, 1)}${"•".repeat(Math.max(3, Math.min(local.length - 1, 8)))}@${domain}`;
}

export const PASSWORD_MIN = 10;
/**
 * bcrypt only reads the first 72 BYTES of a password and silently ignores the
 * rest. Allowing longer would let someone believe a 100-character passphrase
 * protects them when only the first 72 bytes do.
 */
export const PASSWORD_MAX_BYTES = 72;

/** The handful that every guessing list starts with, including this system's own demo password. */
const OBVIOUS = new Set(["password", "password1", "password123", "1234567890", "12345678910", "qwertyuiop", "changeme!123", "iloveyou123", "welcome123", "admin12345"]);

export type PasswordCheck = { ok: true } | { ok: false; message: string };

export function checkNewPassword(password: string, confirm: string, context: { email: string; name?: string }): PasswordCheck {
  if (password.length < PASSWORD_MIN) return { ok: false, message: `Use at least ${PASSWORD_MIN} characters` };
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) return { ok: false, message: `Use at most ${PASSWORD_MAX_BYTES} characters` };
  if (password !== confirm) return { ok: false, message: "The two passwords don't match" };

  const lower = password.toLowerCase();
  if (OBVIOUS.has(lower)) return { ok: false, message: "That password is on every guessing list — choose another" };
  if (/^(.)\1+$/.test(password)) return { ok: false, message: "A single repeated character isn't a password" };

  const localPart = context.email.split("@")[0]?.toLowerCase() ?? "";
  if (localPart.length >= 4 && lower.includes(localPart)) return { ok: false, message: "Don't use your email address in your password" };
  const firstName = context.name?.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (firstName.length >= 4 && lower.includes(firstName)) return { ok: false, message: "Don't use your name in your password" };

  return { ok: true };
}

/**
 * Was this session signed in before the password last changed?
 *
 * `authTime` is seconds (JWT convention); a session from before this check
 * existed has none and counts as "before" — but only matters once a password
 * has actually been changed, so nobody is signed out by the upgrade itself.
 */
export function sessionPredatesPasswordChange(authTimeSec: number | undefined, passwordChangedAt: Date | null): boolean {
  if (!passwordChangedAt) return false;
  // Whole seconds on the session side; allow the same second.
  return (authTimeSec ?? 0) < Math.floor(passwordChangedAt.getTime() / 1000);
}
