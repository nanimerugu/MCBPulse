"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError } from "@/lib/rbac";
import { localDateISO } from "@/lib/time-zone";
import { actorOf, requireAcademicsAccessForAction, str } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { SisError } from "@/modules/sis/students.service";
import { assignSubstitute, cancelSubstitution } from "@/modules/academics/substitutions.service";
import { branchTimeZone } from "@/modules/connect/quiet-hours";

// Bound arguments come back from the browser and could be edited; they are
// re-validated here and resolved through the branch in the service.
const assignTarget = z.object({ slotId: z.uuid(), dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), staffId: z.uuid() });

function toFormState(error: unknown): FormState {
  if (error instanceof SisError || error instanceof ForbiddenError) return { error: error.message };
  throw error;
}

export async function assignCoverAction(target: { slotId: string; dateISO: string; staffId: string }, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAcademicsAccessForAction(str(formData, "branchId"), "academics.substitutions", "configure");
    const parsed = assignTarget.safeParse(target);
    if (!parsed.success) return { error: "That lesson or teacher couldn't be found" };
    const reason = str(formData, "reason")?.trim().slice(0, 200) || undefined;
    const todayISO = localDateISO(new Date(), await branchTimeZone(access.ctx.branch.id));

    await assignSubstitute(
      { slotId: parsed.data.slotId, dateISO: parsed.data.dateISO, substituteStaffId: parsed.data.staffId, reason },
      { organizationId: access.ctx.organizationId, branchId: access.ctx.branch.id, todayISO },
      actorOf(access),
    );
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/academics/substitutions");
  revalidatePath("/academics/periods");
  return { success: "Cover arranged — they've been notified, and the lesson's register is now theirs" };
}

export async function cancelCoverAction(substitutionId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAcademicsAccessForAction(str(formData, "branchId"), "academics.substitutions", "configure");
    if (!z.uuid().safeParse(substitutionId).success) return { error: "That cover arrangement couldn't be found" };
    await cancelSubstitution(substitutionId, { organizationId: access.ctx.organizationId, branchId: access.ctx.branch.id }, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/academics/substitutions");
  revalidatePath("/academics/periods");
  return { success: "Cover cancelled" };
}
