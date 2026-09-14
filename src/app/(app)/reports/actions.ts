"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError } from "@/lib/rbac";
import { actorOf, requireReportingAccessForAction, str, type ModuleAccess } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { fieldErrors } from "@/modules/sis/schemas";
import { SisError } from "@/modules/sis/students.service";
import { TERMS } from "@/modules/reporting/grading-scale";
import { generateReportCard, publishReportCard, type ReportScope } from "@/modules/reporting/report-cards.service";

function toFormState(error: unknown): FormState {
  if (error instanceof SisError || error instanceof ForbiddenError) return { error: error.message };
  throw error;
}
function values(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
function scopeOf(access: ModuleAccess): ReportScope {
  return { organizationId: access.ctx.organizationId, branchId: access.ctx.branch.id };
}

export async function generateReportCardAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let outcome: { subjects: number; overallPercent: number | null };
  try {
    const access = await requireReportingAccessForAction(str(formData, "branchId"), "reporting.cards", "create");
    const parsed = z
      .object({
        studentId: z.string().min(1, "Choose a student"),
        academicYearId: z.string().min(1, "Choose an academic year"),
        term: z.enum(TERMS as unknown as [string, ...string[]]),
        remarks: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(1000).optional()),
      })
      .safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

    outcome = await generateReportCard(
      {
        studentId: parsed.data.studentId,
        academicYearId: parsed.data.academicYearId,
        term: parsed.data.term,
        remarks: parsed.data.remarks as string | undefined,
      },
      scopeOf(access),
      actorOf(access),
    );
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/reports");
  return {
    success: `Generated from ${outcome.subjects} subject${outcome.subjects === 1 ? "" : "s"}${outcome.overallPercent !== null ? ` — ${outcome.overallPercent}% overall` : ""}`,
  };
}

export async function publishReportCardAction(reportCardId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireReportingAccessForAction(str(formData, "branchId"), "reporting.cards", "publish");
    await publishReportCard(reportCardId, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/reports/${reportCardId}`);
  revalidatePath("/reports");
  return { success: "Published — the family can see it in the portal, and it can no longer be regenerated" };
}
