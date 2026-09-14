"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ForbiddenError } from "@/lib/rbac";
import { withBranch } from "@/lib/branch-context";
import { actorOf, requireSisAccessForAction, str } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { fieldErrors, staffInputSchema } from "@/modules/sis/schemas";
import { createStaff } from "@/modules/sis/staff.service";
import { SisError } from "@/modules/sis/students.service";

export async function createStaffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const branchId = str(formData, "branchId");
  let ctx: { branch: { id: string }; branches: unknown[] };
  try {
    const access = await requireSisAccessForAction(branchId, "sis.staff", "create");
    const values: Record<string, string> = {};
    for (const [k, v] of formData.entries()) if (typeof v === "string") values[k] = v;
    const parsed = staffInputSchema.safeParse(values);
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createStaff(parsed.data, { branchId: access.ctx.branch.id }, actorOf(access));
    ctx = access.ctx;
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  revalidatePath("/staff");
  revalidatePath("/settings/users");
  redirect(withBranch("/staff?created=1", ctx as never));
}
