import "server-only";
import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { AUTOMATION_FLAG } from "@/modules/sis/access";
import { notifyStudentGuardians, notifyUser, unreachedWarning } from "@/modules/connect/notify";
import { matches, renderMessage, type Condition, type EventFacts, type ImmediateEventKind } from "@/modules/automation/rules";

/**
 * The automation engine's runtime, for triggers that are something HAPPENING.
 *
 * `emit()` is called by modules after they have committed their own work,
 * and is BEST-EFFORT in exactly the way Connect's notify is: a rule that
 * throws must never roll back the payment, the register or the enrolment
 * that triggered it. A school's records are not hostage to its automations.
 *
 * Kept apart from the rule administration in automation.service.ts so that
 * the modules which emit (SIS, Finance, Academics, Operations) don't import
 * the admin service — and so nothing that emits can end up in an import
 * cycle with the module whose errors that service throws.
 */

export interface EmitContext {
  organizationId: string;
  /** The student the event is about, when there is one — the notify target. */
  studentId?: string;
}

export interface RuleForAction {
  name: string;
  action: "NOTIFY_GUARDIANS" | "NOTIFY_USER";
  messageBody: string;
  createdByUserId: string;
}

/**
 * Carry out a matched rule and describe what happened, for its run history.
 *
 * "Notify me" means the person who WROTE the rule. It used to notify
 * whoever happened to trigger the event — the cashier who took the
 * payment — which is not what the form promised, and for a date-based rule
 * there is nobody triggering anything at all.
 *
 * Throws only when the action is impossible (no student to reach); an
 * action that ran but reached nobody returns the plain-English reason.
 */
export async function performRuleAction(rule: RuleForAction, facts: EventFacts, target: { organizationId: string; studentId?: string | null }): Promise<string> {
  const { text, unresolved } = renderMessage(rule.messageBody, facts);
  let detail: string;
  if (rule.action === "NOTIFY_GUARDIANS") {
    if (!target.studentId) throw new Error("There is no student here whose guardians could be notified");
    const outcome = await notifyStudentGuardians(target.studentId, text, { organizationId: target.organizationId });
    detail = unreachedWarning(outcome) ?? `Notified ${outcome.queued} guardian${outcome.queued === 1 ? "" : "s"}`;
  } else {
    await notifyUser(rule.createdByUserId, rule.name, text);
    detail = "In-app notification sent to the rule's author";
  }
  if (unresolved.length > 0) detail += ` · unresolved placeholders: ${unresolved.join(", ")}`;
  return detail;
}

export async function emit(kind: ImmediateEventKind, facts: EventFacts, ctx: EmitContext): Promise<void> {
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

      try {
        const detail = await performRuleAction(rule, facts, { organizationId: ctx.organizationId, studentId: ctx.studentId });
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
