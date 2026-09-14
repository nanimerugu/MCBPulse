"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError } from "@/lib/rbac";
import { actorOf, requireAutomationAccessForAction, str } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { fieldErrors } from "@/modules/sis/schemas";
import { SisError } from "@/modules/sis/students.service";
import { EVENT_KINDS, OPERATORS, type Condition, type EventKind, type Operator } from "@/modules/automation/rules";
import { createRule, deleteRule, setRuleActive } from "@/modules/automation/automation.service";

function toFormState(error: unknown): FormState {
  if (error instanceof SisError || error instanceof ForbiddenError) return { error: error.message };
  throw error;
}
function values(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

export async function createRuleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAutomationAccessForAction(str(formData, "branchId"), "automation.rules", "configure");
    const parsed = z
      .object({
        name: z.string().trim().min(1, "Give the rule a name").max(80),
        eventKind: z.enum(EVENT_KINDS as unknown as [string, ...string[]]),
        action: z.enum(["NOTIFY_GUARDIANS", "NOTIFY_USER"]),
        messageBody: z.string().trim().min(1, "Write the message").max(1000),
      })
      .safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

    // Up to three condition rows; blanks are dropped so a rule with no
    // conditions ("every time this happens") is expressible.
    const conditions: Condition[] = [];
    for (let i = 0; i < 3; i++) {
      const field = str(formData, `field${i}`)?.trim();
      const operator = str(formData, `operator${i}`);
      const value = str(formData, `value${i}`)?.trim();
      if (!field || !value) continue;
      if (!OPERATORS.includes(operator as Operator)) return { error: "That comparison isn't one of the allowed ones" };
      conditions.push({ field, operator: operator as Operator, value });
    }

    await createRule(
      {
        name: parsed.data.name,
        eventKind: parsed.data.eventKind as EventKind,
        conditions,
        action: parsed.data.action,
        messageBody: parsed.data.messageBody,
      },
      access.ctx.organizationId,
      actorOf(access),
    );
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/automation");
  return { success: "Rule created" };
}

export async function setRuleActiveAction(ruleId: string, active: boolean, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAutomationAccessForAction(str(formData, "branchId"), "automation.rules", "configure");
    await setRuleActive(ruleId, active, access.ctx.organizationId, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/automation");
  return { success: active ? "Rule enabled" : "Rule paused" };
}

export async function deleteRuleAction(ruleId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAutomationAccessForAction(str(formData, "branchId"), "automation.rules", "configure");
    await deleteRule(ruleId, access.ctx.organizationId, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/automation");
  return { success: "Rule deleted — its run history is kept" };
}
