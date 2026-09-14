import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { isScheduledKind, type Condition, type EventKind } from "@/modules/automation/rules";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * Rule administration. The runtime lives elsewhere: `emit()` in emit.ts for
 * triggers that happen, `evaluateDateRules()` in scheduled.service.ts for
 * triggers that come round on a date.
 */

export async function listRules(organizationId: string) {
  return db.automationRule.findMany({
    where: { organizationId, deletedAt: null },
    include: { _count: { select: { runs: true } }, runs: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

export async function getRule(ruleId: string, organizationId: string) {
  return db.automationRule.findFirst({
    where: { id: ruleId, organizationId, deletedAt: null },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 30 } },
  });
}

export async function createRule(
  input: {
    name: string;
    eventKind: EventKind;
    conditions: Condition[];
    action: "NOTIFY_GUARDIANS" | "NOTIFY_USER";
    messageBody: string;
    offsetDays: number | null;
  },
  organizationId: string,
  actor: Actor,
) {
  if (input.messageBody.trim().length === 0) throw new SisError("Write the message this rule should send");
  if (isScheduledKind(input.eventKind) !== (input.offsetDays !== null)) {
    throw new SisError(isScheduledKind(input.eventKind) ? "A date-based rule needs a number of days" : "Only date-based rules take a number of days");
  }
  const clash = await db.automationRule.findFirst({ where: { organizationId, name: input.name, deletedAt: null } });
  if (clash) throw new SisError(`A rule called "${input.name}" already exists`);

  const rule = await db.automationRule.create({
    data: {
      organizationId,
      name: input.name,
      eventKind: input.eventKind,
      conditions: input.conditions as unknown as object,
      action: input.action,
      messageBody: input.messageBody,
      offsetDays: input.offsetDays,
      createdByUserId: actor.userId,
    },
  });
  await recordAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    action: "automation_rule.created",
    resourceType: "automation_rule",
    resourceId: rule.id,
    after: { name: input.name, eventKind: input.eventKind, offsetDays: input.offsetDays, action: input.action, conditions: input.conditions.length },
  });
  return rule;
}

export async function setRuleActive(ruleId: string, active: boolean, organizationId: string, actor: Actor) {
  const rule = await db.automationRule.findFirst({ where: { id: ruleId, organizationId, deletedAt: null } });
  if (!rule) throw new SisError("Rule not found");

  await db.automationRule.update({ where: { id: ruleId }, data: { active } });
  await recordAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    action: active ? "automation_rule.enabled" : "automation_rule.disabled",
    resourceType: "automation_rule",
    resourceId: ruleId,
    after: { name: rule.name, active },
  });
}

export async function deleteRule(ruleId: string, organizationId: string, actor: Actor) {
  const rule = await db.automationRule.findFirst({ where: { id: ruleId, organizationId, deletedAt: null } });
  if (!rule) throw new SisError("Rule not found");

  // Soft delete: the run history explains messages families already got.
  await db.automationRule.update({ where: { id: ruleId }, data: { deletedAt: new Date(), active: false } });
  await recordAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    action: "automation_rule.deleted",
    resourceType: "automation_rule",
    resourceId: ruleId,
    after: { name: rule.name },
  });
}
