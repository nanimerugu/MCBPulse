import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { CONNECT_FLAG } from "@/modules/sis/access";
import { getProvider } from "@/modules/connect/providers";
import { sendBroadcast } from "@/modules/connect/broadcasts.service";

/**
 * The queue worker Connect always assumed and never had.
 *
 * Before the scheduler, a message held back by quiet hours was written as
 * QUEUED and then nothing ever sent it; a broadcast deferred to 07:00 sat
 * SCHEDULED at 07:00 and every morning after. The delivery log showed them,
 * so nothing was silently lost — but "recorded as waiting forever" is not
 * what a school means by quiet hours.
 *
 * AT MOST ONCE. Each message is claimed with a conditional update before it
 * is sent, so two runners can never both send it. A runner that dies
 * between the claim and the send leaves that message QUEUED with no
 * notBefore — visible in the delivery log, never retried. For a text to a
 * parent, one missing message a person can see beats a duplicate nobody
 * can take back.
 */

export async function deliverHeldMessages(now: Date, organizationId: string | null): Promise<Record<string, number>> {
  const due = await db.message.findMany({
    where: { status: "QUEUED", notBefore: { lte: now }, ...(organizationId ? { organizationId } : {}) },
    orderBy: { notBefore: "asc" },
    take: 500,
  });

  let sent = 0;
  let failed = 0;
  let claimedElsewhere = 0;
  let heldModuleOff = 0;
  const connectOn = new Map<string, boolean>();

  for (const m of due) {
    let on = connectOn.get(m.organizationId);
    if (on === undefined) {
      on = await isFeatureEnabled(CONNECT_FLAG, m.organizationId);
      connectOn.set(m.organizationId, on);
    }
    // Switching Communication off means stop contacting families — including
    // with messages that were waiting for the morning.
    if (!on) {
      heldModuleOff++;
      continue;
    }

    const claim = await db.message.updateMany({
      where: { id: m.id, status: "QUEUED", notBefore: m.notBefore },
      data: { notBefore: null },
    });
    if (claim.count === 0) {
      claimedElsewhere++;
      continue;
    }

    const provider = getProvider(m.channel);
    try {
      const result = await provider.send({ channel: m.channel, to: m.recipientAddress, subject: null, body: m.body ?? "" });
      await db.message.update({
        where: { id: m.id },
        data: {
          status: result.status,
          provider: provider.name,
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
        where: { id: m.id },
        data: { status: "FAILED", failureReason: e instanceof Error ? e.message : "Unknown provider error", attempts: { increment: 1 } },
      });
      failed++;
    }
  }

  return { heldMessagesDue: due.length, heldMessagesSent: sent, heldMessagesFailed: failed, heldMessagesClaimedElsewhere: claimedElsewhere, heldMessagesModuleOff: heldModuleOff };
}

/**
 * Broadcasts whose time has come — both those a person scheduled and those
 * quiet hours deferred. `sendBroadcast` claims each one itself, so a person
 * pressing Send at the same moment can't cause a double send.
 */
export async function sendDueBroadcasts(now: Date, organizationId: string | null): Promise<Record<string, number>> {
  const due = await db.broadcast.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now }, ...(organizationId ? { organizationId } : {}) },
    include: { organization: { select: { name: true } }, branch: { select: { id: true, name: true, deletedAt: true } } },
    orderBy: { scheduledAt: "asc" },
    take: 50,
  });

  let broadcastsSent = 0;
  let broadcastMessages = 0;
  let broadcastsDeferred = 0;
  let broadcastsFailed = 0;
  let broadcastsModuleOff = 0;

  for (const b of due) {
    if (!(await isFeatureEnabled(CONNECT_FLAG, b.organizationId))) {
      broadcastsModuleOff++;
      continue;
    }

    const branch =
      b.branch && !b.branch.deletedAt
        ? b.branch
        : await db.branch.findFirst({ where: { organizationId: b.organizationId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });

    try {
      if (!branch) throw new Error("The organization has no branch to resolve an audience in");
      // Said in the audit trail before the send, so the log never shows a
      // person "sending" at 07:00 when it was the scheduler acting for them.
      await recordAuditEvent({
        organizationId: b.organizationId,
        actorUserId: null,
        action: "broadcast.released_by_scheduler",
        resourceType: "broadcast",
        resourceId: b.id,
        after: { scheduledAt: b.scheduledAt?.toISOString() ?? null, onBehalfOf: b.createdByUserId },
      });
      const outcome = await sendBroadcast(
        b.id,
        { organizationId: b.organizationId, branchId: branch.id, branchName: branch.name, organizationName: b.organization.name },
        { userId: b.createdByUserId, organizationId: b.organizationId },
      );
      if (outcome.deferredTo) {
        broadcastsDeferred++;
      } else {
        broadcastsSent++;
        broadcastMessages += outcome.sent;
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Unknown error";
      // Only a broadcast still waiting is marked failed; one another runner
      // (or a person) has already claimed is theirs to finish.
      const marked = await db.broadcast.updateMany({ where: { id: b.id, status: "SCHEDULED" }, data: { status: "FAILED" } });
      if (marked.count > 0) {
        await recordAuditEvent({
          organizationId: b.organizationId,
          actorUserId: null,
          action: "broadcast.scheduled_send_failed",
          resourceType: "broadcast",
          resourceId: b.id,
          after: { reason },
        });
      }
      broadcastsFailed++;
    }
  }

  return { broadcastsDue: due.length, broadcastsSent, broadcastMessages, broadcastsDeferred, broadcastsFailed, broadcastsModuleOff };
}
