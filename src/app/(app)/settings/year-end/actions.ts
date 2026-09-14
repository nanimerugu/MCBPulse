"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, authorize } from "@/lib/rbac";
import { actorOf, requireSisAccessForAction, str, type ModuleAccess } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { SisError } from "@/modules/sis/students.service";
import { DECISIONS, type Decision, type DecisionInput } from "@/modules/sis/promotion";
import { commitYearEnd, copySectionsIntoYear, createNextYear, getPromotionPlan, type YearScope } from "@/modules/sis/year-end.service";

function toFormState(error: unknown): FormState {
  if (error instanceof SisError || error instanceof ForbiddenError) return { error: error.message };
  throw error;
}
const scopeOf = (access: ModuleAccess): YearScope => ({ organizationId: access.ctx.organizationId, branchId: access.ctx.branch.id });

export async function createNextYearAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let copied = 0;
  let name = "";
  try {
    const access = await requireSisAccessForAction(str(formData, "branchId"), "tenant.academic_years", "create");
    const parsed = z
      .object({
        name: z.string().trim().min(1, "Name the year").max(40),
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an end date"),
      })
      .safeParse({ name: str(formData, "name"), start: str(formData, "start"), end: str(formData, "end") });
    if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join(" · ") };
    const r = await createNextYear({ name: parsed.data.name, startISO: parsed.data.start, endISO: parsed.data.end, copySections: str(formData, "copySections") === "on" }, scopeOf(access), actorOf(access));
    copied = r.sectionsCopied;
    name = r.year.name;
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/settings/year-end");
  return { success: `${name} created${copied > 0 ? ` with ${copied} section${copied === 1 ? "" : "s"} copied from this year` : ""}. It isn't current until the year-end is committed.` };
}

export async function copySectionsAction(yearId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireSisAccessForAction(str(formData, "branchId"), "tenant.academic_years", "create");
    if (!z.uuid().safeParse(yearId).success) return { error: "That year couldn't be found" };
    const n = await copySectionsIntoYear(yearId, scopeOf(access), actorOf(access));
    revalidatePath("/settings/year-end");
    return { success: `Copied ${n} section${n === 1 ? "" : "s"}` };
  } catch (e) {
    return toFormState(e);
  }
}

export async function commitYearEndAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireSisAccessForAction(str(formData, "branchId"), "tenant.academic_years", "edit");
    // Moving every child is an enrollment change as well as a calendar one,
    // so both permissions are required — the year-end is not a way around
    // sis.enrollment:edit.
    const canEnroll = await authorize(access.viewer.userId, "sis.enrollment", "edit", { organizationId: access.ctx.organizationId, branchId: access.ctx.branch.id });
    if (!canEnroll) return { error: "Committing the year-end also needs permission to change enrollment (sis.enrollment:edit)" };

    const plan = await getPromotionPlan(scopeOf(access));
    if (!plan.next) return { error: "Create next year first" };
    // Typing the year's name is the whole confirmation: this can't be undone
    // from the screen, and a stray click must not be enough.
    if ((str(formData, "confirm") ?? "").trim() !== plan.next.name) return { fieldErrors: { confirm: `Type ${plan.next.name} exactly to confirm` } };

    const decisions: DecisionInput[] = [];
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("decision:") || typeof value !== "string") continue;
      if (!(DECISIONS as readonly string[]).includes(value)) return { error: "An unknown decision was sent — reload the plan" };
      const studentId = key.slice("decision:".length);
      const target = str(formData, `target:${studentId}`)?.trim() || null;
      const decision = value as Decision;
      decisions.push({ studentId, decision, targetSectionId: decision === "PROMOTE" || decision === "RETAIN" ? target : null });
    }

    const s = await commitYearEnd(decisions, scopeOf(access), actorOf(access));
    revalidatePath("/settings/year-end");
    revalidatePath("/students");
    return {
      success: `${s.from} is closed and ${s.to} is now current: ${s.counts.PROMOTE} promoted, ${s.counts.RETAIN} kept back, ${s.counts.GRADUATE} graduated, ${s.counts.UNPLACED} left to place.`,
    };
  } catch (e) {
    return toFormState(e);
  }
}
