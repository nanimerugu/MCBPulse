import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { AUTOMATION_FLAG } from "@/modules/sis/access";
import { notifyStudentGuardians, notifyUser, unreachedWarning } from "@/modules/connect/notify";
import { matches, renderMessage, type Condition, type EventFacts, type EventKind } from "@/modules/automation/rules";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * The automation engine's runtime.
 *
 * `emit()` is called by modules after they have committed their own work,
 * and is BEST-EFFORT in exactly the way Connect's notify is: a rule that
 * throws must never roll back the payment, the register or the enrolment
 * that triggered it. A school's records are not hostage to its automations.
 *
 * Evaluation is synchronous. With a queue this would be a job, and the
 * README says so — but a synchronous evaluation that runs is worth more than
 * an asynchronous one that doesn't exist, and the work per event is one
 * indexed query plus a string substitution.
 */

export interface EmitContext {
  organizationId: string;
  /** The student the event is about, when there is one — the notify target. */
  studentId?: string;
  /** A user to notify, for rules that inform staff rather than families. */
  userId?: string;
}

export async function emit(kind: EventKind, facts: EventFacts, ctx: EmitContext): Promise<void> {
  try {
    if (!(await isFeatureEnabled(AUTOMATION_FLAG, ctx.organizationId))) return;

    const rules = await db.automationRule.findMany({
      where: { organizationId: ctx.organizationId, eventKind: kind, active: true, deletedAt: null },
    });
    if (rules.length === 0) return;

    for (const rule of rules) {
      const conditions = (rule.conditions ?? []) as unknown as Condition[];
      if (!matches(conditions, facts)) {
        // Recorded, not silent: "why didn't my rule fire?" needs an answer.
        await db.automationRun.create({
          data: { ruleId: rule.id, outcome: "SKIPPED", facts: facts as object, detail: "Conditions not met" },
        });
        continue;
      }

      const { text, unresolved } = renderMessage(rule.messageBody, facts);
      try {
        let detail: string;
        if (rule.action === "NOTIFY_GUARDIANS") {
          if (!ctx.studentId) throw new Error("This event has no student to notify guardians about");
          const outcome = await notifyStudentGuardians(ctx.studentId, text, { organizationId: ctx.organizationId });
          detail = unreachedWarning(outcome) ?? `Notified ${outcome.queued} guardian${outcome.queued === 1 ? "" : "s"}`;
        } else {
          if (!ctx.userId) throw new Error("This event has no user to notify");
          await notifyUser(ctx.userId, rule.name, text);
          detail = "In-app notification sent";
        }
        if (unresolved.length > 0) detail += ` · unresolved placeholders: ${unresolved.join(", ")}`;

        await db.automationRun.create({ data: { ruleId: rule.id, outcome: "MATCHED", facts: facts as object, detail } });
      } catch (e) {
        await db.automationRun.create({
          data: { ruleId: rule.id, outcome: "FAILED", facts: facts as object, detail: e instanceof Error ? e.message : "Unknown error" },
        });
      }
    }
  } catch (e) {
    // Never let an automation break the thing that triggered it.
    console.error("[automation] emit failed", e);
  }
}

// --- Administration ----------------------------------------------------------

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
  input: { name: string; eventKind: EventKind; conditions: Condition[]; action: "NOTIFY_GUARDIANS" | "NOTIFY_USER"; messageBody: string },
  organizationId: string,
  actor: Actor,
) {
  if (input.messageBody.trim().length === 0) throw new SisError("Write the message this rule should send");
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
      createdByUserId: actor.userId,
    },
  });
  await recordAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    action: "automation_rule.created",
    resourceType: "automation_rule",
    resourceId: rule.id,
    after: { name: input.name, eventKind: input.eventKind, action: input.action, conditions: input.conditions.length },
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
