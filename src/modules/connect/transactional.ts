import "server-only";
import { db } from "@/lib/db";
import { getProvider } from "@/modules/connect/providers";

/**
 * Security messages: an invitation or a password reset.
 *
 * Different from everything else Connect sends in three ways, all deliberate:
 *
 *  1. THE LOG NEVER SEES THE LINK. The delivery log is readable by front-office
 *     staff, and a reset link in it would let anyone with that permission sign
 *     in as the principal. The provider gets the real body; the Message row
 *     gets `logBody`, which says a link was sent without containing it.
 *  2. No quiet hours and no marketing opt-out. The person asked for this, or
 *     needs it to get in at all; holding a reset link until 7am helps nobody,
 *     and an SMS opt-out is not a refusal of the one email that sets up an
 *     account.
 *  3. Always email. A link is a credential; it goes to the address that is
 *     the sign-in name, not to a phone number that may be shared.
 */
export async function sendSecurityMessage(input: {
  organizationId: string | null;
  to: string;
  recipientName: string;
  subject: string;
  body: string;
  logBody: string;
}): Promise<{ delivered: boolean; status: "SENT" | "FAILED" }> {
  const provider = getProvider("EMAIL");
  let status: "SENT" | "FAILED" = "FAILED";
  let failureReason: string | null = null;
  let providerMessageId: string | null = null;

  try {
    const result = await provider.send({ channel: "EMAIL", to: input.to, subject: input.subject, body: input.body });
    status = result.status;
    failureReason = result.failureReason ?? null;
    providerMessageId = result.providerMessageId ?? null;
  } catch (e) {
    failureReason = e instanceof Error ? e.message : "Unknown provider error";
  }

  // A platform-level account with no organization has no delivery log to
  // write to; the audit event the caller records still says it happened.
  if (input.organizationId) {
    await db.message.create({
      data: {
        organizationId: input.organizationId,
        channel: "EMAIL",
        recipientName: input.recipientName,
        recipientAddress: input.to,
        body: input.logBody,
        status,
        provider: provider.name,
        providerMessageId,
        failureReason,
        attempts: 1,
        sentAt: status === "SENT" ? new Date() : null,
      },
    });
  }

  return { delivered: provider.delivers && status === "SENT", status };
}
