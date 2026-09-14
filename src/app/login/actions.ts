"use server";

import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { checkRateLimit, clearRateLimit, clientIpFrom, LOGIN_RULE, retryAfterSeconds } from "@/lib/rate-limit";

/**
 * Sign-in, throttled.
 *
 * Without a limit, a login form is an offline password-guessing oracle that
 * answers as fast as the server can hash. Eight attempts per ten minutes
 * per IP+email costs a real person nothing on a mistyped password and makes
 * a dictionary run impractical.
 *
 * The key is IP **and** email together, deliberately:
 *   - IP alone lets one office behind a single NAT lock out its own staff.
 *   - Email alone lets an attacker lock a known user out of their account
 *     from anywhere, which turns the protection into the attack.
 * Together, a guesser is slowed on the pair they are actually attacking.
 *
 * A successful sign-in clears the count, so a person who fumbles a password
 * twice and then gets it right is not carrying a penalty for ten minutes.
 */
export async function authenticate(_prevState: string | undefined, formData: FormData): Promise<string | undefined> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const ip = clientIpFrom(await headers());
  const key = `login:${ip}:${email}`;

  const limit = checkRateLimit(key, LOGIN_RULE);
  if (limit.limited) {
    // Audited without an organization: a burst of these against one address
    // is the signal someone is being attacked, and it needs to be visible.
    await recordAuditEvent({
      organizationId: null,
      actorUserId: null,
      action: "auth.rate_limited",
      resourceType: "user",
      resourceId: email || "unknown",
      after: { ip },
    }).catch(() => {});
    const seconds = retryAfterSeconds(limit);
    return `Too many sign-in attempts. Try again in ${Math.ceil(seconds / 60)} minute${seconds > 60 ? "s" : ""}.`;
  }

  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
  } catch (error) {
    // NEXT_REDIRECT is how signIn() signals success in a server action —
    // it must be rethrown, not swallowed as a login failure. It is also the
    // only place we know the attempt worked, so the counter clears here.
    if (error && typeof error === "object" && "digest" in error && typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT")) {
      clearRateLimit(key);
      throw error;
    }
    if (error instanceof AuthError) {
      // Deliberately identical whether the email is unknown or the password
      // is wrong: a different message here is a user-enumeration oracle.
      return "Invalid email or password.";
    }
    throw error;
  }
  return undefined;
}
