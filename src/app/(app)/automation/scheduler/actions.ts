"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/lib/rbac";
import { requireAutomationAccessForAction, str } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { SisError } from "@/modules/sis/students.service";
import { runJobForOrganization } from "@/modules/scheduler/runner.service";
import { humanizeCountKey } from "@/modules/scheduler/schedule";

/**
 * "Run now", for this school only. Gated on configuring automation, because
 * it can send this school's reminders; it can't send them EARLY, since every
 * job only acts on what is already due.
 */
export async function runJobNowAction(jobKey: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAutomationAccessForAction(str(formData, "branchId"), "automation.rules", "configure");
    const outcome = await runJobForOrganization(jobKey, access.ctx.organizationId, access.viewer.userId);
    revalidatePath("/automation/scheduler");
    revalidatePath("/automation");
    if (outcome.status === "busy") return { error: "That job is running right now — try again in a minute" };
    if (outcome.status === "failed") return { error: `The job failed: ${outcome.error ?? "unknown error"}` };
    const counts = Object.entries(outcome.summary ?? {})
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${v} ${humanizeCountKey(k)}`)
      .join(", ");
    return { success: counts ? `Done — ${counts}` : "Done — nothing was due" };
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
}
