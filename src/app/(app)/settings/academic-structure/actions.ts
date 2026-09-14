"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/lib/rbac";
import { actorOf, requireSisAccessForAction, str } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { fieldErrors, gradeInputSchema, sectionInputSchema } from "@/modules/sis/schemas";
import { createGrade, createSection } from "@/modules/sis/structure.service";
import { SisError } from "@/modules/sis/students.service";

function values(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

export async function createGradeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireSisAccessForAction(str(formData, "branchId"), "academics.structure", "configure");
    const parsed = gradeInputSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createGrade(access.ctx.branch.id, parsed.data, actorOf(access));
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  revalidatePath("/settings/academic-structure");
  return { success: "Grade added" };
}

export async function createSectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireSisAccessForAction(str(formData, "branchId"), "academics.structure", "configure");
    if (!access.ctx.academicYear) return { error: "This branch has no current academic year" };
    const parsed = sectionInputSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createSection({ ...parsed.data, academicYearId: access.ctx.academicYear.id }, actorOf(access));
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  revalidatePath("/settings/academic-structure");
  return { success: "Section added" };
}
