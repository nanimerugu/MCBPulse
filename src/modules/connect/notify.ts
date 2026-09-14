import "server-only";
import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { CONNECT_FLAG } from "@/modules/sis/access";
import { addressKindFor, isWithinQuietHours, planDelivery, type QuietHours, type Recipient } from "@/modules/connect/delivery-policy";
import { getProvider } from "@/modules/connect/providers";
import { render } from "@/modules/connect/templates";

/**
 * The internal notification API other modules call — the "shared services"
 * layer of the blueprint's architecture (section 7), rather than each
 * module growing its own idea of how to reach a parent.
 *
 * Everything here is best-effort and never throws into the caller: an
 * attendance register must still save if the SMS gateway is down. Failures
 * land in the delivery log, which is where someone looking for them will be.
 */

const ABSENCE_BODY =
  "{{school.name}}: {{student.first_name}} ({{student.section}}) was marked absent on {{attendance.date}}. Please contact the school if this is unexpected.";

async function quietHoursOf(organizationId: string): Promise<QuietHours | null> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { quietHoursStart: true, quietHoursEnd: true } });
  if (!org?.quietHoursStart || !org?.quietHoursEnd) return null;
  return { start: org.quietHoursStart, end: org.quietHoursEnd };
}

export interface AbsenceNotice {
  studentId: string;
  dateISO: string;
}

/**
 * Tells guardians their child was marked absent (blueprint 11.3 "parent
 * notifications"). Called after a register is saved. Silent when Connect is
 * off for the organization; queued rather than sent during quiet hours,
 * because an absence notice at 6am helps nobody.
 */
export async function notifyAbsences(
  notices: AbsenceNotice[],
  scope: { organizationId: string; branchId: string; branchName: string },
): Promise<{ queued: number; sent: number }> {
  if (notices.length === 0) return { queued: 0, sent: 0 };
  if (!(await isFeatureEnabled(CONNECT_FLAG, scope.organizationId))) return { queued: 0, sent: 0 };

  try {
    const links = await db.studentGuardian.findMany({
      where: { studentId: { in: notices.map((n) => n.studentId) }, student: { organizationId: scope.organizationId } },
      include: {
        guardian: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, optOutSms: true, optOutEmail: true } },
        student: { select: { id: true, firstName: true, lastName: true, currentSection: { select: { name: true, grade: { select: { name: true } } } } } },
      },
    });
    if (links.length === 0) return { queued: 0, sent: 0 };

    const channel = "SMS" as const;
    const wantsEmail = addressKindFor(channel) === "email";
    const byStudent = new Map(notices.map((n) => [n.studentId, n.dateISO]));

    // One message per (guardian, student): a parent with two absent
    // children should hear about both, so the de-dup key includes the child.
    const recipients: Recipient[] = links.map((l) => ({
      key: `${l.guardian.id}:${l.student.id}`,
      name: `${l.guardian.firstName} ${l.guardian.lastName}`.trim(),
      address: (wantsEmail ? l.guardian.email ?? "" : l.guardian.phone) ?? "",
      channel,
      optedOut: wantsEmail ? l.guardian.optOutEmail : l.guardian.optOutSms,
    }));
    // Address-level de-duplication would collapse those two, so plan on a
    // per-pair basis and keep the pairing.
    const plan = planDelivery(recipients.map((r) => ({ ...r, address: `${r.address}#${r.key}` })));

    const quiet = await quietHoursOf(scope.organizationId);
    const quietNow = isWithinQuietHours(new Date(), quiet);
    const provider = getProvider(channel);

    let queued = 0;
    let sent = 0;

    for (const planned of plan.send) {
      const key = planned.key;
      const link = links.find((l) => `${l.guardian.id}:${l.student.id}` === key);
      if (!link) continue;
      const address = (wantsEmail ? link.guardian.email ?? "" : link.guardian.phone) ?? "";
      const { text } = render(ABSENCE_BODY, {
        "school.name": scope.branchName,
        "student.first_name": link.student.firstName,
        "student.section": link.student.currentSection ? `${link.student.currentSection.grade.name} / ${link.student.currentSection.name}` : "",
        "attendance.date": byStudent.get(link.student.id) ?? "",
      });

      const message = await db.message.create({
        data: {
          organizationId: scope.organizationId,
          channel,
          recipientName: planned.name,
          recipientAddress: address,
          body: text,
          status: "QUEUED",
          provider: provider.name,
        },
      });
      queued++;

      if (quietNow) continue; // left QUEUED for the worker / next send window

      try {
        const result = await provider.send({ channel, to: address, subject: null, body: text });
        await db.message.update({
          where: { id: message.id },
          data: {
            status: result.status,
            providerMessageId: result.providerMessageId ?? null,
            failureReason: result.failureReason ?? null,
            attempts: { increment: 1 },
            sentAt: result.status === "SENT" ? new Date() : null,
          },
        });
        if (result.status === "SENT") sent++;
      } catch (e) {
        await db.message.update({
          where: { id: message.id },
          data: { status: "FAILED", failureReason: e instanceof Error ? e.message : "Unknown provider error", attempts: { increment: 1 } },
        });
      }
    }

    return { queued, sent };
  } catch (e) {
    // Never let a notification failure roll back or reject the thing that
    // triggered it.
    console.error("[connect] absence notification failed", e);
    return { queued: 0, sent: 0 };
  }
}

/** In-app notification for a user (the bell, not a carrier). */
export async function notifyUser(userId: string, title: string, body: string) {
  try {
    await db.notification.create({ data: { userId, title, body } });
  } catch (e) {
    console.error("[connect] in-app notification failed", e);
  }
}
