import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Who may ring the scheduler's bell.
 *
 * `/api/cron/tick` is reachable from the internet by necessity — a platform
 * cron calls it over HTTP — so it is guarded by a shared secret sent as
 * `Authorization: Bearer <CRON_SECRET>`, the convention Vercel Cron and most
 * schedulers already follow.
 *
 * FAILS CLOSED. No secret configured, or one too short to be a secret, means
 * the endpoint refuses everyone; there is no "open in development" mode for
 * something that sends messages to families.
 */

export const MIN_SECRET_LENGTH = 32;

export type CronAuthResult = "ok" | "not_configured" | "unauthorized";

export function checkCronAuth(authorizationHeader: string | null, secret: string | undefined): CronAuthResult {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return "not_configured";
  if (!authorizationHeader) return "unauthorized";

  const m = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!m) return "unauthorized";

  // Hash both sides first: timingSafeEqual needs equal lengths, and comparing
  // raw lengths would itself leak the secret's length.
  const given = createHash("sha256").update(m[1]!).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, expected) ? "ok" : "unauthorized";
}
