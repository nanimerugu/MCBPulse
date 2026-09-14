import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { MessageChannel } from "@/generated/prisma/enums";
import { zonedLocalToUtc } from "@/lib/time-zone";
import { isWithinQuietHours, nextSendableAt, planDelivery, SUPPRESSION_LABELS } from "@/modules/connect/delivery-policy";
import { getProvider } from "@/modules/connect/providers";
import { branchTimeZone, quietHoursFor } from "@/modules/connect/quiet-hours";
import { render, unknownVariables } from "@/modules/connect/templates";
import { parseAudience, resolveAudience, type AudienceSpec } from "@/modules/connect/audience";
import { SisError, type Actor } from "@/modules/sis/students.service";

export interface BroadcastScope {
  organizationId: string;
  branchId: string;
  branchName: string;
  organizationName: string;
}

export async function listBroadcasts(organizationId: string) {
  return db.broadcast.findMany({
    where: { organizationId },
    include: { template: { select: { name: true } }, _count: { select: { messages: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function getBroadcast(broadcastId: string, organizationId: string) {
  const broadcast = await db.broadcast.findFirst({
    where: { id: broadcastId, organizationId },
    include: { template: true, messages: { orderBy: { createdAt: "asc" }, take: 500 } },
  });
  if (!broadcast) return null;
  const counts = broadcast.messages.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.status]: (acc[m.status] ?? 0) + 1 }), {});
  return { broadcast, counts };
}

export async function createBroadcast(
  input: { channel: MessageChannel; subject?: string; body: string; audience: AudienceSpec; templateId?: string; scheduledAt?: string },
  scope: BroadcastScope,
  actor: Actor,
) {
  const unknown = unknownVariables(input.body);
  if (unknown.length > 0) throw new SisError(`Unknown template variable(s): ${unknown.join(", ")}`);

  // What was typed is a time on the campus clock. It used to be stored as if
  // it were UTC — harmless while nothing acted on it, wrong by five and a
  // half hours now that the scheduler really sends at that moment.
  let scheduledAt: Date | null = null;
  if (input.scheduledAt) {
    scheduledAt = zonedLocalToUtc(input.scheduledAt, await branchTimeZone(scope.branchId));
    if (!scheduledAt) throw new SisError("That isn't a real date and time");
  }

  const broadcast = await db.broadcast.create({
    data: {
      organizationId: actor.organizationId,
      branchId: scope.branchId,
      templateId: input.templateId ?? null,
      channel: input.channel,
      audience: input.audience as object,
      subject: input.subject ?? null,
      body: input.body,
      createdByUserId: actor.userId,
      scheduledAt,
      status: scheduledAt ? "SCHEDULED" : "DRAFT",
    },
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "broadcast.created",
    resourceType: "broadcast",
    resourceId: broadcast.id,
    after: { channel: input.channel, audience: input.audience, scheduledAt: input.scheduledAt ?? null },
  });
  return broadcast;
}

export interface SendPreview {
  willSend: number;
  suppressed: { name: string; address: string; reason: string }[];
  sample: { name: string; address: string; text: string; missing: string[] } | null;
  quietHoursNow: boolean;
  deferUntil: Date | null;
  providerDelivers: boolean;
}

/** What would happen if this went out now — shown before the send button. */
export async function previewBroadcast(broadcastId: string, scope: BroadcastScope): Promise<SendPreview> {
  const broadcast = await db.broadcast.findFirst({ where: { id: broadcastId, organizationId: scope.organizationId } });
  if (!broadcast) throw new SisError("Broadcast not found");
  const spec = parseAudience(broadcast.audience);
  if (!spec) throw new SisError("This broadcast has an unreadable audience");

  const members = await resolveAudience(spec, broadcast.channel, scope);
  const plan = planDelivery(members.map((m) => m.recipient));
  const { quiet, timeZone } = await quietHoursFor(scope.organizationId, scope.branchId);
  const now = new Date();

  const first = plan.send[0];
  const firstMember = first ? members.find((m) => m.recipient.key === first.key) : undefined;
  const rendered = firstMember ? render(broadcast.body, firstMember.context) : null;

  return {
    willSend: plan.send.length,
    suppressed: plan.suppressed.map((s) => ({ name: s.recipient.name, address: s.recipient.address, reason: SUPPRESSION_LABELS[s.reason] })),
    sample: first && rendered ? { name: first.name, address: first.address, text: rendered.text, missing: rendered.missing } : null,
    quietHoursNow: isWithinQuietHours(now, quiet, timeZone),
    deferUntil: isWithinQuietHours(now, quiet, timeZone) ? nextSendableAt(now, quiet, timeZone) : null,
    providerDelivers: getProvider(broadcast.channel).delivers,
  };
}

export interface SendOutcome {
  sent: number;
  failed: number;
  suppressed: number;
  deferredTo: Date | null;
}

/**
 * Resolves the audience, applies consent and de-duplication, renders per
 * recipient, and writes one Message row per person before handing it to the
 * provider — so a crash mid-send leaves a queue, not a mystery.
 *
 * Quiet hours defer rather than block: the broadcast is scheduled for the
 * next sendable moment, and the scheduler's deferred-delivery job sends it
 * then (src/modules/connect/deferred.service.ts).
 */
export async function sendBroadcast(broadcastId: string, scope: BroadcastScope, actor: Actor, opts: { ignoreQuietHours?: boolean } = {}): Promise<SendOutcome> {
  const broadcast = await db.broadcast.findFirst({ where: { id: broadcastId, organizationId: scope.organizationId } });
  if (!broadcast) throw new SisError("Broadcast not found");
  if (broadcast.status === "SENT" || broadcast.status === "SENDING") throw new SisError("This broadcast has already been sent");

  const spec = parseAudience(broadcast.audience);
  if (!spec) throw new SisError("This broadcast has an unreadable audience");

  const { quiet, timeZone } = await quietHoursFor(scope.organizationId, scope.branchId);
  const now = new Date();
  if (!opts.ignoreQuietHours && isWithinQuietHours(now, quiet, timeZone)) {
    const deferTo = nextSendableAt(now, quiet, timeZone);
    await db.broadcast.update({ where: { id: broadcastId }, data: { status: "SCHEDULED", scheduledAt: deferTo, branchId: broadcast.branchId ?? scope.branchId } });
    await recordAuditEvent({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "broadcast.deferred_quiet_hours",
      resourceType: "broadcast",
      resourceId: broadcastId,
      after: { deferredTo: deferTo.toISOString(), quietHours: quiet },
    });
    return { sent: 0, failed: 0, suppressed: 0, deferredTo: deferTo };
  }

  const members = await resolveAudience(spec, broadcast.channel, scope);
  const plan = planDelivery(members.map((m) => m.recipient));
  if (plan.send.length === 0) throw new SisError("Nobody in this audience can be contacted on that channel");

  // Claim it. Two people pressing Send together — or a person and the
  // scheduler — must not both send it: only one conditional update can move
  // the broadcast out of the status it was read in.
  const claimed = await db.broadcast.updateMany({
    where: { id: broadcastId, status: broadcast.status },
    data: { status: "SENDING", branchId: broadcast.branchId ?? scope.branchId },
  });
  if (claimed.count === 0) throw new SisError("This broadcast is already being sent");

  const provider = getProvider(broadcast.channel);
  let sent = 0;
  let failed = 0;

  for (const recipient of plan.send) {
    const member = members.find((m) => m.recipient.key === recipient.key)!;
    const { text } = render(broadcast.body, member.context);

    const message = await db.message.create({
      data: {
        organizationId: actor.organizationId,
        broadcastId,
        channel: broadcast.channel,
        recipientName: recipient.name,
        recipientAddress: recipient.address,
        body: text,
        status: "QUEUED",
        provider: provider.name,
      },
    });

    try {
      const result = await provider.send({ channel: broadcast.channel, to: recipient.address, subject: broadcast.subject, body: text });
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
      else failed++;
    } catch (e) {
      await db.message.update({
        where: { id: message.id },
        data: { status: "FAILED", failureReason: e instanceof Error ? e.message : "Unknown provider error", attempts: { increment: 1 } },
      });
      failed++;
    }
  }

  await db.broadcast.update({ where: { id: broadcastId }, data: { status: failed > 0 && sent === 0 ? "FAILED" : "SENT", sentAt: new Date(), approvedByUserId: actor.userId } });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "broadcast.sent",
    resourceType: "broadcast",
    resourceId: broadcastId,
    after: {
      channel: broadcast.channel,
      audience: spec,
      sent,
      failed,
      suppressed: plan.suppressed.length,
      provider: provider.name,
      delivered: provider.delivers,
    },
  });

  return { sent, failed, suppressed: plan.suppressed.length, deferredTo: null };
}

export async function listMessages(organizationId: string, filters: { status?: string; channel?: MessageChannel } = {}) {
  return db.message.findMany({
    where: {
      organizationId,
      ...(filters.status ? { status: filters.status as "QUEUED" | "SENT" | "DELIVERED" | "FAILED" } : {}),
      ...(filters.channel ? { channel: filters.channel } : {}),
    },
    include: { broadcast: { select: { id: true, subject: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function setQuietHours(input: { start: string | null; end: string | null }, actor: Actor) {
  const before = await db.organization.findUnique({ where: { id: actor.organizationId }, select: { quietHoursStart: true, quietHoursEnd: true } });
  await db.organization.update({ where: { id: actor.organizationId }, data: { quietHoursStart: input.start, quietHoursEnd: input.end } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "connect.quiet_hours_set",
    resourceType: "organization",
    resourceId: actor.organizationId,
    before: { start: before?.quietHoursStart ?? null, end: before?.quietHoursEnd ?? null },
    after: { start: input.start, end: input.end },
  });
}

export async function setGuardianOptOut(guardianId: string, input: { optOutSms: boolean; optOutEmail: boolean }, actor: Actor) {
  const guardian = await db.guardian.findFirst({
    where: { id: guardianId, studentLinks: { some: { student: { organizationId: actor.organizationId } } } },
  });
  if (!guardian) throw new SisError("Guardian not found");
  await db.guardian.update({ where: { id: guardianId }, data: input });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "connect.consent_changed",
    resourceType: "guardian",
    resourceId: guardianId,
    before: { optOutSms: guardian.optOutSms, optOutEmail: guardian.optOutEmail },
    after: input,
  });
}
