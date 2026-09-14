"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError } from "@/lib/rbac";
import { actorOf, requireFinanceAccessForAction, str, type ModuleAccess } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { SisError } from "@/modules/sis/students.service";
import { formatMoney, parseMoneyInput } from "@/modules/finance/money";
import {
  chargeLibraryFine,
  runMonthlyOpsBilling,
  setLibraryFinePolicy,
  setMonthlyFee,
  waiveLibraryFine,
  type BillingScope,
} from "@/modules/finance/ops-billing.service";

function toFormState(error: unknown): FormState {
  if (error instanceof SisError || error instanceof ForbiddenError) return { error: error.message };
  throw error;
}
const scopeOf = (access: ModuleAccess): BillingScope => ({ organizationId: access.ctx.organizationId, branchId: access.ctx.branch.id });
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** Blank means "no rate"; anything else must be a real amount. */
function optionalMoney(raw: string | undefined): { ok: true; minor: number | null } | { ok: false } {
  const v = (raw ?? "").trim();
  if (v === "") return { ok: true, minor: null };
  const minor = parseMoneyInput(v);
  return minor === null ? { ok: false } : { ok: true, minor };
}

export async function setLibraryFinePolicyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireFinanceAccessForAction(str(formData, "branchId"), "finance.fee_structures", "configure");
    const perDay = optionalMoney(str(formData, "perDay"));
    const cap = optionalMoney(str(formData, "cap"));
    if (!perDay.ok) return { fieldErrors: { perDay: "Enter an amount like 5 or 5.50, or leave it blank" } };
    if (!cap.ok) return { fieldErrors: { cap: "Enter an amount, or leave it blank for no cap" } };
    await setLibraryFinePolicy({ perDayMinor: perDay.minor, capMinor: cap.minor }, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/finance/ops-billing");
  return { success: "Library fine rate saved. It applies to books returned from now on." };
}

export async function setMonthlyFeeAction(target: { kind: "hostel" | "transport"; id: string }, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireFinanceAccessForAction(str(formData, "branchId"), "finance.fee_structures", "configure");
    const parsed = z.object({ kind: z.enum(["hostel", "transport"]), id: z.uuid() }).safeParse(target);
    if (!parsed.success) return { error: "That block or route couldn't be found" };
    const fee = optionalMoney(str(formData, "monthlyFee"));
    if (!fee.ok) return { fieldErrors: { monthlyFee: "Enter an amount, or leave it blank to stop billing" } };
    await setMonthlyFee(parsed.data.kind, parsed.data.id, fee.minor, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/finance/ops-billing");
  return { success: "Saved" };
}

export async function chargeFineAction(issueId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireFinanceAccessForAction(str(formData, "branchId"), "finance.invoices", "create");
    if (!z.uuid().safeParse(issueId).success) return { error: "That fine couldn't be found" };
    const due = str(formData, "dueDate") ?? "";
    if (!isoDate.test(due)) return { fieldErrors: { dueDate: "Pick a due date" } };
    const r = await chargeLibraryFine(issueId, due, scopeOf(access), actorOf(access));
    revalidatePath("/finance/ops-billing");
    revalidatePath("/finance/invoices");
    return { success: `Charged ${formatMoney(r.amountMinor)} on ${r.invoiceNumber}` };
  } catch (e) {
    return toFormState(e);
  }
}

export async function waiveFineAction(issueId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireFinanceAccessForAction(str(formData, "branchId"), "finance.invoices", "create");
    if (!z.uuid().safeParse(issueId).success) return { error: "That fine couldn't be found" };
    await waiveLibraryFine(issueId, str(formData, "reason") ?? "", scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/finance/ops-billing");
  return { success: "Fine waived — the reason is kept in the audit trail" };
}

export async function runBillingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireFinanceAccessForAction(str(formData, "branchId"), "finance.invoices", "create");
    const monthRaw = str(formData, "month") ?? "";
    const m = /^(\d{4})-(\d{2})$/.exec(monthRaw);
    if (!m) return { fieldErrors: { month: "Pick a month" } };
    const due = str(formData, "dueDate") ?? "";
    if (!isoDate.test(due)) return { fieldErrors: { dueDate: "Pick a due date" } };

    const s = await runMonthlyOpsBilling({ year: Number(m[1]), month: Number(m[2]), dueDateISO: due }, scopeOf(access), actorOf(access));
    revalidatePath("/finance/ops-billing");
    revalidatePath("/finance/invoices");
    revalidatePath("/finance");
    const made = s.hostelInvoices + s.transportInvoices;
    const parts = [
      made > 0 ? `${s.hostelInvoices} hostel and ${s.transportInvoices} transport invoice${made === 1 ? "" : "s"} for ${formatMoney(s.totalMinor)}` : "No new invoices",
      s.alreadyBilled > 0 ? `${s.alreadyBilled} already billed for ${s.month}, skipped` : null,
    ].filter(Boolean);
    if (s.failed > 0) return { error: `${parts.join("; ")}. ${s.failed} couldn't be billed — ${s.firstFailure}` };
    return { success: `${s.month}: ${parts.join("; ")}.` };
  } catch (e) {
    return toFormState(e);
  }
}
