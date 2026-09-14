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
import { createDeductionRule, setDeclaredDeduction, setDeductionRuleActive, setMonthlyBasicPay } from "@/modules/hr/deduction-rules.service";

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

export async function setBasicPayAction(staffId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireHrAccessForAction(str(formData, "branchId"), "hr.compensation", "edit");
    const raw = str(formData, "monthlyBasicPay")?.trim() ?? "";
    const minor = raw === "" ? null : parseMoneyInput(raw);
    if (raw !== "" && minor === null) return { fieldErrors: { monthlyBasicPay: "Enter an amount like 25000, or leave it empty" } };
    await setMonthlyBasicPay(staffId, minor, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/hr/people/${staffId}`);
  return { success: "Basic pay saved" };
}

export async function setDeclaredDeductionAction(target: { staffId: string; ruleId: string }, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireHrAccessForAction(str(formData, "branchId"), "hr.compensation", "edit");
    const ids = z.object({ staffId: z.uuid(), ruleId: z.uuid() }).safeParse(target);
    if (!ids.success) return { error: "That person or rule couldn't be found" };
    const raw = str(formData, "monthlyAmount")?.trim() ?? "";
    const minor = raw === "" ? null : parseMoneyInput(raw);
    if (raw !== "" && minor === null) return { fieldErrors: { monthlyAmount: "Enter an amount, or leave it empty to clear" } };
    await setDeclaredDeduction({ ...ids.data, monthlyMinor: minor, note: str(formData, "note")?.trim() || undefined }, actorOf(access));
    revalidatePath(`/hr/people/${ids.data.staffId}`);
  } catch (e) {
    return toFormState(e);
  }
  return { success: "Saved — it applies from the next payslips generated" };
}

export async function createDeductionRuleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireHrAccessForAction(str(formData, "branchId"), "hr.payroll", "configure");
    const basis = z.enum(["PERCENT_OF_BASIC", "PERCENT_OF_GROSS", "FIXED", "DECLARED"]).safeParse(str(formData, "basis"));
    if (!basis.success) return { fieldErrors: { basis: "Choose a basis" } };

    const percent = (key: string): number | null | "bad" => {
      const raw = str(formData, key)?.trim() ?? "";
      if (raw === "") return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : "bad";
    };
    const amount = (key: string): number | null | "bad" => {
      const raw = str(formData, key)?.trim() ?? "";
      if (raw === "") return null;
      return parseMoneyInput(raw) ?? "bad";
    };
    const employeePercent = percent("employeePercent");
    const employerPercent = percent("employerPercent");
    const fixedMinor = amount("fixedAmount");
    const wageCeilingMinor = amount("wageCeiling");
    const grossEligibilityMaxMinor = amount("grossEligibilityMax");
    for (const [key, v] of Object.entries({ employeePercent, employerPercent, fixedAmount: fixedMinor, wageCeiling: wageCeilingMinor, grossEligibilityMax: grossEligibilityMaxMinor })) {
      if (v === "bad") return { fieldErrors: { [key]: "That isn't a number" } };
    }

    await createDeductionRule(
      {
        code: str(formData, "code") ?? "",
        name: str(formData, "name") ?? "",
        basis: basis.data,
        employeePercent: employeePercent as number | null,
        employerPercent: employerPercent as number | null,
        fixedMinor: fixedMinor as number | null,
        wageCeilingMinor: wageCeilingMinor as number | null,
        grossEligibilityMaxMinor: grossEligibilityMaxMinor as number | null,
      },
      actorOf(access),
    );
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/hr/payroll/rules");
  return { success: "Rule added — it applies to payslips generated from now on" };
}

export async function setDeductionRuleActiveAction(ruleId: string, active: boolean, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireHrAccessForAction(str(formData, "branchId"), "hr.payroll", "configure");
    if (!z.uuid().safeParse(ruleId).success) return { error: "Rule not found" };
    await setDeductionRuleActive(ruleId, active, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/hr/payroll/rules");
  return { success: active ? "Rule switched on" : "Rule switched off" };
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
    await requestStaffLeave(staffId, { ...rest, unpaid: str(formData, "unpaid") === "on" }, actorOf(access));
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
    const ruleNote = outcome.ruleNotApplied > 0 ? ` · On ${outcome.ruleNotApplied} payslip${outcome.ruleNotApplied === 1 ? "" : "s"} a rule didn't apply — each says why` : "";
    const lopNote = outcome.totals.lossOfPayDays > 0 ? ` · ${outcome.totals.lossOfPayDays} day${outcome.totals.lossOfPayDays === 1 ? "" : "s"} of unpaid leave deducted` : "";
    return { success: `${outcome.generated} payslip${outcome.generated === 1 ? "" : "s"} generated${lopNote}${ruleNote}${skipNote}` };
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
  let paid: { netMinor: number; deductionsMinor: number; employerMinor: number };
  try {
    const access = await requireHrAccessForAction(str(formData, "branchId"), "hr.payroll", "approve");
    paid = await payPayrollRun(runId, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/hr/payroll/${runId}`);
  revalidatePath("/hr/payroll");
  revalidatePath("/finance/ledger");
  const owed = paid.deductionsMinor + paid.employerMinor;
  return {
    success: `Marked paid — ${(paid.netMinor / 100).toFixed(2)} from the bank${owed > 0 ? `, ${(owed / 100).toFixed(2)} recorded as deductions payable` : ""}, posted to the ledger`,
  };
}
