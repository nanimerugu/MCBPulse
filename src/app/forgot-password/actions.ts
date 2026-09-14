"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkRateLimit, clientIpFrom, retryAfterSeconds, type RateLimitRule } from "@/lib/rate-limit";
import { completeWithLink, requestPasswordReset, type LinkPurpose } from "@/modules/identity/portal-access.service";

/**
 * The signed-out account actions: ask for a reset, and use a one-time link.
 *
 * Both are open to the internet, so both are throttled, and the request
 * answers identically — in words AND in time — whether or not the address
 * has an account.
 */

/** Per address, per IP: a person who can't find the email tries a few times. */
const RESET_REQUEST_RULE: RateLimitRule = { max: 5, windowMs: 15 * 60_000 };
/** Per IP across all addresses: stops one host from mailing a whole staff list. */
const RESET_REQUEST_IP_RULE: RateLimitRule = { max: 20, windowMs: 60 * 60_000 };
/** Submitting a password against a link. Tokens can't be guessed; this caps the noise. */
const LINK_SUBMIT_RULE: RateLimitRule = { max: 10, windowMs: 10 * 60_000 };
/**
 * A request for a real account does more work (a token, a message) than one
 * for an unknown address. Padding every response to this floor keeps the
 * difference from being measurable.
 */
const MIN_RESPONSE_MS = 800;

export type ResetRequestState = { sent?: boolean; error?: string } | undefined;

export async function requestResetAction(_prev: ResetRequestState, formData: FormData): Promise<ResetRequestState> {
  const started = Date.now();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter the email address you sign in with." };

  const ip = clientIpFrom(await headers());
  const byAddress = checkRateLimit(`reset:${ip}:${email}`, RESET_REQUEST_RULE);
  const byIp = checkRateLimit(`reset-ip:${ip}`, RESET_REQUEST_IP_RULE);
  const limited = byAddress.limited ? byAddress : byIp.limited ? byIp : null;
  if (limited) {
    const minutes = Math.ceil(retryAfterSeconds(limited) / 60);
    return { error: `Too many requests. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` };
  }

  try {
    await requestPasswordReset(email);
  } catch (e) {
    // The answer stays the same; the failure goes to the server log.
    console.error("[auth] password reset request failed", e);
  }

  const remaining = MIN_RESPONSE_MS - (Date.now() - started);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
  return { sent: true };
}

export async function completeLinkAction(token: string, purpose: LinkPurpose, _prev: string | undefined, formData: FormData): Promise<string | undefined> {
  const ip = clientIpFrom(await headers());
  const limit = checkRateLimit(`link:${ip}`, LINK_SUBMIT_RULE);
  if (limit.limited) {
    const minutes = Math.ceil(retryAfterSeconds(limit) / 60);
    return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }

  // The service re-checks that this token is for this purpose, so a tampered
  // `purpose` gets "not valid", never a reset through an invitation.
  const result = await completeWithLink(token, purpose, String(formData.get("password") ?? ""), String(formData.get("confirm") ?? ""));
  if (!result.ok) return result.message;
  redirect(`/login?notice=${purpose === "INVITE" ? "welcome" : "reset"}`);
}
