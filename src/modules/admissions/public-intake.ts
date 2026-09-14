import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { checkRateLimit, PUBLIC_FORM_RULE } from "@/lib/rate-limit";
import { ADMISSIONS_FLAG } from "@/modules/sis/access";
import { DuplicateLeadError, createLead, findOrCreateSource } from "@/modules/admissions/leads.service";
import type { PublicEnquiryInput } from "@/modules/admissions/schemas";

/**
 * The public enquiry form is the one unauthenticated write in the system,
 * so it gets the blueprint's section-18 protections in miniature:
 *   - a honeypot field (bots fill it, humans can't see it),
 *   - a per-IP rate limit,
 *   - de-duplication that never tells the caller whether a phone number is
 *     already known (a duplicate is logged against the existing lead and
 *     the form still says "thank you").
 * The rate limiter is in-process — fine for one server; move it to Redis
 * (blueprint section 6) before running more than one instance. It is shared
 * with the login form: see src/lib/rate-limit.ts.
 */

/**
 * Kept as a named export so the route reads the same, but the counting now
 * lives in src/lib/rate-limit.ts — Phase 12 needed the same logic on the
 * login form, and two implementations of "have they done this too often"
 * is one more than a system should have.
 */
export function rateLimited(ip: string, now = Date.now()): boolean {
  return checkRateLimit(`enquiry:${ip}`, PUBLIC_FORM_RULE, now).limited;
}

export async function resolvePublicBranch(orgSlug: string, branchCode: string) {
  const organization = await db.organization.findFirst({
    where: { slug: orgSlug, deletedAt: null, status: { in: ["ACTIVE", "TRIAL"] } },
    select: { id: true, name: true, slug: true },
  });
  if (!organization) return null;
  const branch = await db.branch.findFirst({
    where: { organizationId: organization.id, code: branchCode.toUpperCase(), deletedAt: null, status: { in: ["ACTIVE", "ONBOARDING"] } },
    select: { id: true, name: true, code: true },
  });
  if (!branch) return null;
  if (!(await isFeatureEnabled(ADMISSIONS_FLAG, organization.id))) return null;
  return { organization, branch };
}

export type PublicEnquiryResult = { ok: true } | { ok: false; reason: "not_found" | "rate_limited" | "bot" };

export async function submitPublicEnquiry(
  orgSlug: string,
  branchCode: string,
  input: PublicEnquiryInput,
  ip: string,
): Promise<PublicEnquiryResult> {
  if (input.website) return { ok: false, reason: "bot" }; // honeypot
  const target = await resolvePublicBranch(orgSlug, branchCode);
  if (!target) return { ok: false, reason: "not_found" };
  if (rateLimited(ip)) return { ok: false, reason: "rate_limited" };

  const source = await findOrCreateSource(target.organization.id, "Website");
  const note = [input.gradeInterest ? `Interested in: ${input.gradeInterest}` : null, input.message ? `Message: ${input.message}` : null]
    .filter(Boolean)
    .join(" · ");

  try {
    await createLead(
      { name: input.name, phone: input.phone, email: input.email, note: note || undefined },
      { organizationId: target.organization.id, branchId: target.branch.id, actorUserId: null, sourceId: source.id, viaPublicForm: true },
    );
  } catch (e) {
    if (e instanceof DuplicateLeadError) {
      // Same person enquiring again: note it on the existing lead, say nothing different to the form.
      await recordAuditEvent({
        organizationId: target.organization.id,
        actorUserId: null,
        action: "lead.enquired_again",
        resourceType: "lead",
        resourceId: e.existing.id,
        after: { via: "website", branch: target.branch.code, ...(note ? { note } : {}) },
      });
      return { ok: true };
    }
    throw e;
  }
  return { ok: true };
}
