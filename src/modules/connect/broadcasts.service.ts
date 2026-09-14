import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { MessageChannel } from "@/generated/prisma/enums";
import { isWithinQuietHours, nextSendableAt, planDelivery, SUPPRESSION_LABELS, type QuietHours } from "@/modules/connect/delivery-policy";
import { getProvider } from "@/modules/connect/providers";
import { render, unknownVariables } from "@/modules/connect/templates";
import { parseAudience, resolveAudience, type AudienceSpec } from "@/modules/connect/audience";
import { SisError, type Actor } from "@/modules/sis/students.service";

export interface BroadcastScope {
  organizationId: string;
  branchId: string;
  branchName: string;
  organizationName: string;
}

async function quietHoursOf(organizationId: string): Promise<QuietHours | null> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { quietHoursStart: true, quietHoursEnd: true } });
  if (!org?.quietHoursStart || !org?.quietHoursEnd) return null;
  return { start: org.quietHoursStart, end: org.quietHoursEnd };
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

  const broadcast = await db.broadcast.create({
    data: {
      organizationId: actor.organizationId,
      templateId: input.templateId ?? null,
      channel: input.channel,
      audience: input.audience as object,
      subject: input.subject ?? null,
      body: input.body,
      createdByUserId: actor.userId,
      scheduledAt: input.scheduledAt ? new Date(`${input.scheduledAt}:00.000Z`) : null,
      status: input.scheduledAt ? "SCHEDULED" : "DRAFT",
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
  const quiet = await quietHoursOf(scope.organizationId);
  const now = new Date();

  const first = plan.send[0];
  const firstMember = first ? members.find((m) => m.recipient.key === first.key) : undefined;
  const rendered = firstMember ? render(broadcast.body, firstMember.context) : null;

  return {
    willSend: plan.send.length,
    suppressed: plan.suppressed.map((s) => ({ name: s.recipient.name, address: s.recipient.address, reason: SUPPRESSION_LABELS[s.reason] })),
    sample: first && rendered ? { name: first.name, address: first.address, text: rendered.text, missing: rendered.missing } : null,
    quietHoursNow: isWithinQuietHours(now, quiet),
    deferUntil: isWithinQuietHours(now, quiet) ? nextSendableAt(now, quiet) : null,
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
 * next sendable moment (a real deployment runs the queue worker from
 * section 6; here the scheduled time is recorded and the send stops).
 */
export async function sendBroadcast(broadcastId: string, scope: BroadcastScope, actor: Actor, opts: { ignoreQuietHours?: boolean } = {}): Promise<SendOutcome> {
  const broadcast = await db.broadcast.findFirst({ where: { id: broadcastId, organizationId: scope.organizationId } });
  if (!broadcast) throw new SisError("Broadcast not found");
  if (broadcast.status === "SENT" || broadcast.status === "SENDING") throw new SisError("This broadcast has already been sent");

  const spec = parseAudience(broadcast.audience);
  if (!spec) throw new SisError("This broadcast has an unreadable audience");

  const quiet = await quietHoursOf(scope.organizationId);
  const now = new Date();
  if (!opts.ignoreQuietHours && isWithinQuietHours(now, quiet)) {
    const deferTo = nextSendableAt(now, quiet);
    await db.broadcast.update({ where: { id: broadcastId }, data: { status: "SCHEDULED", scheduledAt: deferTo } });
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

  await db.broadcast.update({ where: { id: broadcastId }, data: { status: "SENDING" } });

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
