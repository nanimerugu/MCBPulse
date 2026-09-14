"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError } from "@/lib/rbac";
import { actorOf, requireReportingAccessForAction, str, type ModuleAccess } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { fieldErrors } from "@/modules/sis/schemas";
import { SisError } from "@/modules/sis/students.service";
import { getSectionScope, sectionInScope } from "@/modules/academics/scope";
import { TERMS } from "@/modules/reporting/grading-scale";
import { parseBandLines } from "@/modules/reporting/band-input";
import { checkWeights } from "@/modules/reporting/weighting";
import {
  createScale,
  generateReportCard,
  publishReportCard,
  saveReportComments,
  setDefaultScale,
  type GenerateOutcome,
  type ReportScope,
} from "@/modules/reporting/report-cards.service";

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
  let outcome: GenerateOutcome;
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
  const dropped = outcome.droppedComments.length > 0 ? ` Comments for ${outcome.droppedComments.join(", ")} were removed — those subjects no longer have marks.` : "";
  return {
    success: `Generated from ${outcome.subjects} subject${outcome.subjects === 1 ? "" : "s"}${outcome.overallPercent !== null ? ` — ${outcome.overallPercent}% overall` : ""}.${dropped}`,
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

export async function saveCommentsAction(reportCardId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  let changed = 0;
  try {
    const access = await requireReportingAccessForAction(str(formData, "branchId"), "reporting.cards", "create");
    // A teacher comments only on their own sections' students — the same
    // attribute policy as the report list, enforced again on the write.
    const sectionScope = await getSectionScope(access);
    const comments: { lineId: string; comment: string }[] = [];
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string" && key.startsWith("comment:")) comments.push({ lineId: key.slice("comment:".length), comment: value });
    }
    ({ changed } = await saveReportComments(
      reportCardId,
      { comments, remarks: str(formData, "remarks") },
      scopeOf(access),
      actorOf(access),
      (sectionId) => sectionInScope(sectionScope, sectionId ?? ""),
    ));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/reports/${reportCardId}`);
  return { success: changed === 0 ? "Nothing had changed" : `Saved ${changed} change${changed === 1 ? "" : "s"}` };
}

export async function createScaleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireReportingAccessForAction(str(formData, "branchId"), "reporting.scales", "configure");
    const name = z.string().trim().min(1, "Name the scale").max(60).safeParse(str(formData, "name"));
    if (!name.success) return { fieldErrors: { name: name.error.issues[0]?.message ?? "Name the scale" } };

    const bands = parseBandLines(str(formData, "bands") ?? "");
    if (!bands.ok) return { error: bands.errors.join(" · ") };

    const weights = checkWeights(str(formData, "examWeight"), str(formData, "courseworkWeight"));
    if (!weights.ok) return { fieldErrors: { examWeight: weights.message } };

    await createScale({ name: name.data, bands: bands.bands, isDefault: str(formData, "isDefault") === "on", weights: weights.weights }, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/reports");
  return { success: "Scale created" };
}

export async function setDefaultScaleAction(scaleId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireReportingAccessForAction(str(formData, "branchId"), "reporting.scales", "configure");
    await setDefaultScale(scaleId, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/reports");
  return { success: "New reports will use this scale. Existing reports keep the one they were made with." };
}
