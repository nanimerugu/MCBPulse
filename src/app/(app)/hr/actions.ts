"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ForbiddenError } from "@/lib/rbac";
import { withBranch } from "@/lib/branch-context";
import { actorOf, requireHrAccessForAction, str, type ModuleAccess } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { fieldErrors } from "@/modules/sis/schemas";
import { SisError } from "@/modules/sis/students.service";
import { parseMoneyInput } from "@/modules/finance/money";
import { assignStaffToOrgUnit, createDepartment, createPosition } from "@/modules/hr/org.service";
import { recordAppraisal, recordStaffExit, setMonthlyGrossPay } from "@/modules/hr/compensation.service";
import { decideStaffLeave, requestStaffLeave } from "@/modules/hr/staff-leave.service";
import { generatePayslips, openPayrollRun, payPayrollRun, processPayrollRun, type PayrollScope } from "@/modules/hr/payroll.service";

function toFormState(error: unknown): FormState {
  if (error instanceof SisError || error instanceof ForbiddenError) return { error: error.message };
  throw error;
}
function values(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
function scopeOf(access: ModuleAccess): PayrollScope {
  return { organizationId: access.ctx.organizationId, branchId: access.ctx.branch.id };
}
const optional = (schema: z.ZodTypeAny) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");

// --- Org chart ---------------------------------------------------------------

export async function createDepartmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireHrAccessForAction(str(formData, "branchId"), "hr.org", "configure");
    const parsed = z.object({ name: z.string().trim().min(1, "Name is required").max(80) }).safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createDepartment(parsed.data.name, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/hr/org");
  return { success: "Department added" };
}

export async function createPositionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireHrAccessForAction(str(formData, "branchId"), "hr.org", "configure");
    const parsed = z
      .object({ title: z.string().trim().min(1, "Title is required").max(80), departmentId: optional(z.string()) })
      .safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createPosition({ title: parsed.data.title, departmentId: parsed.data.departmentId as string | undefined }, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/hr/org");
  return { success: "Position added" };
}

export async function assignOrgUnitAction(staffId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireHrAccessForAction(str(formData, "branchId"), "hr.org", "configure");
    await assignStaffToOrgUnit(
      staffId,
      { departmentId: str(formData, "departmentId") || null, positionId: str(formData, "positionId") || null },
      actorOf(access),
    );
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/hr/people/${staffId}`);
  revalidatePath("/hr/people");
  return { success: "Department and position updated" };
}

// --- Compensation, appraisal, exit -------------------------------------------

export async function setPayAction(staffId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireHrAccessForAction(str(formData, "branchId"), "hr.compensation", "edit");
    const raw = str(formData, "monthlyGrossPay")?.trim() ?? "";
    // An empty box clears the figure; that takes them off payroll rather
    // than paying them zero.
    if (raw === "") {
      await setMonthlyGrossPay(staffId, null, actorOf(access));
    } else {
      const minor = parseMoneyInput(raw);
      if (minor === null) return { fieldErrors: { monthlyGrossPay: "Enter an amount like 45000 or 45000.50" } };
      await setMonthlyGrossPay(staffId, minor, actorOf(access));
    }
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/hr/people/${staffId}`);
  revalidatePath("/hr/people");
  return { success: "Monthly pay saved" };
}

export async function recordAppraisalAction(staffId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireHrAccessForAction(str(formData, "branchId"), "hr.appraisals", "edit");
    const parsed = z
      .object({
        academicYearId: z.string().min(1, "Choose an academic year"),
        score: optional(z.coerce.number().int().min(1, "Score is 1 to 5").max(5, "Score is 1 to 5")),
        comments: z.string().trim().min(1, "Write at least a sentence").max(2000),
      })
      .safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await recordAppraisal(
      staffId,
      { academicYearId: parsed.data.academicYearId, score: (parsed.data.score as number | undefined) ?? null, comments: parsed.data.comments },
      actorOf(access),
    );
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/hr/people/${staffId}`);
  return { success: "Appraisal recorded" };
}

export async function recordExitAction(staffId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireHrAccessForAction(str(formData, "branchId"), "hr.exit", "edit");
    const parsed = z.object({ exitDate: isoDate, reason: z.string().trim().min(1, "Give a reason").max(500) }).safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await recordStaffExit(staffId, { exitDate: new Date(`${parsed.data.exitDate}T00:00:00.000Z`), reason: parsed.data.reason }, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/hr/people/${staffId}`);
  revalidatePath("/hr/people");
  return { success: "Exit recorded and the login disabled" };
}

// --- Leave -------------------------------------------------------------------

export async function requestStaffLeaveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireHrAccessForAction(str(formData, "branchId"), "hr.leave", "create");
    const parsed = z
      .object({
        staffId: z.string().min(1, "Choose a staff member"),
        fromDate: isoDate,
        toDate: isoDate,
        reason: z.string().trim().min(1, "Give a reason").max(500),
      })
      .safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    const { staffId, ...rest } = parsed.data;
    await requestStaffLeave(staffId, rest, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/hr/leave");
  revalidatePath("/hr");
  return { success: "Leave request recorded" };
}

export async function decideStaffLeaveAction(leaveId: string, decision: "APPROVED" | "REJECTED", _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireHrAccessForAction(str(formData, "branchId"), "hr.leave", "approve");
    await decideStaffLeave(leaveId, decision, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/hr/leave");
  revalidatePath("/hr");
  return { success: decision === "APPROVED" ? "Approved" : "Rejected" };
}

// --- Payroll -----------------------------------------------------------------

export async function openPayrollRunAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let runId: string;
  let ctx: { branch: { id: string }; branches: unknown[] };
  try {
    const access = await requireHrAccessForAction(str(formData, "branchId"), "hr.payroll", "create");
    const parsed = z
      .object({
        month: z.coerce.number().int().min(1).max(12),
        year: z.coerce.number().int().min(2000).max(2100),
        deductionPercent: z.coerce.number().min(0, "0 or more").max(100, "100 or less"),
        fixedDeduction: optional(z.string()),
        deductionDescription: optional(z.string().max(200)),
      })
      .safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

    const fixedRaw = (parsed.data.fixedDeduction as string | undefined)?.trim();
    const fixedMinor = fixedRaw ? parseMoneyInput(fixedRaw) : 0;
    if (fixedMinor === null) return { fieldErrors: { fixedDeduction: "Enter an amount like 200 or 200.50" } };

    const run = await openPayrollRun(
      {
        month: parsed.data.month,
        year: parsed.data.year,
        deductionPercent: parsed.data.deductionPercent,
        fixedDeductionMinor: fixedMinor,
        deductionDescription: parsed.data.deductionDescription as string | undefined,
      },
      scopeOf(access),
      actorOf(access),
    );
    runId = run.id;
    ctx = access.ctx;
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/hr/payroll");
  redirect(withBranch(`/hr/payroll/${runId}`, ctx as never));
}

export async function generatePayslipsAction(runId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireHrAccessForAction(str(formData, "branchId"), "hr.payroll", "create");
    const outcome = await generatePayslips(runId, scopeOf(access), actorOf(access));
    revalidatePath(`/hr/payroll/${runId}`);
    revalidatePath("/hr/payroll");
    // Name whoever was left off and why. A bare "2 skipped" is how someone
    // quietly goes unpaid for a month without anyone noticing which someone.
    const skipNote =
      outcome.skipped.length > 0
        ? ` · Skipped: ${outcome.skipped.map((s) => `${s.name} (${s.employeeCode}) — ${s.reason}`).join("; ")}`
        : "";
    return { success: `${outcome.generated} payslip${outcome.generated === 1 ? "" : "s"} generated${skipNote}` };
  } catch (e) {
    return toFormState(e);
  }
}

export async function processPayrollRunAction(runId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireHrAccessForAction(str(formData, "branchId"), "hr.payroll", "approve");
    await processPayrollRun(runId, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/hr/payroll/${runId}`);
  revalidatePath("/hr/payroll");
  return { success: "Run processed — the figures are now frozen" };
}

export async function payPayrollRunAction(runId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  let netMinor: number;
  try {
    const access = await requireHrAccessForAction(str(formData, "branchId"), "hr.payroll", "approve");
    ({ netMinor } = await payPayrollRun(runId, scopeOf(access), actorOf(access)));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/hr/payroll/${runId}`);
  revalidatePath("/hr/payroll");
  revalidatePath("/finance/ledger");
  return { success: `Marked paid — ${(netMinor / 100).toFixed(2)} posted to the ledger` };
}
