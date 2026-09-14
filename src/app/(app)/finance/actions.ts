"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ForbiddenError } from "@/lib/rbac";
import { withBranch } from "@/lib/branch-context";
import { actorOf, requireFinanceAccessForAction, str } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { fieldErrors } from "@/modules/sis/schemas";
import { SisError } from "@/modules/sis/students.service";
import {
  concessionSchema,
  feeHeadSchema,
  feeStructureLineSchema,
  feeStructureSchema,
  paymentSchema,
  raiseForSectionSchema,
  raiseInvoiceSchema,
  refundRequestSchema,
} from "@/modules/finance/schemas";
import { addFeeStructureLine, createFeeHead, createFeeStructure, grantConcession, removeFeeStructureLine } from "@/modules/finance/fees.service";
import { cancelInvoice, raiseInvoice, raiseInvoicesForSection } from "@/modules/finance/invoices.service";
import { decideRefund, recordPayment, requestRefund } from "@/modules/finance/payments.service";

function toFormState(error: unknown): FormState {
  if (error instanceof SisError || error instanceof ForbiddenError) return { error: error.message };
  throw error;
}
function values(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
type Ctx = { branch: { id: string }; branches: unknown[] };

// --- Fee heads & structures ---------------------------------------------------

export async function createFeeHeadAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireFinanceAccessForAction(str(formData, "branchId"), "finance.fee_structures", "configure");
    const parsed = feeHeadSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createFeeHead(parsed.data.name, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/finance/fee-structures");
  return { success: "Fee head added" };
}

export async function createFeeStructureAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireFinanceAccessForAction(str(formData, "branchId"), "finance.fee_structures", "configure");
    if (!access.ctx.academicYear) return { error: "This branch has no current academic year" };
    const parsed = feeStructureSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createFeeStructure(parsed.data, { branchId: access.ctx.branch.id, academicYearId: access.ctx.academicYear.id }, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/finance/fee-structures");
  return { success: "Structure created — add its lines below" };
}

export async function addLineAction(structureId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireFinanceAccessForAction(str(formData, "branchId"), "finance.fee_structures", "configure");
    const parsed = feeStructureLineSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await addFeeStructureLine(structureId, { feeHeadId: parsed.data.feeHeadId, amountMinor: parsed.data.amount }, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/finance/fee-structures");
  return { success: "Line saved" };
}

export async function removeLineAction(formData: FormData): Promise<void> {
  const lineId = str(formData, "lineId");
  if (!lineId) return;
  try {
    const access = await requireFinanceAccessForAction(str(formData, "branchId"), "finance.fee_structures", "configure");
    await removeFeeStructureLine(lineId, actorOf(access));
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return;
    throw e;
  }
  revalidatePath("/finance/fee-structures");
}

// --- Concessions ------------------------------------------------------------------

export async function grantConcessionAction(studentId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireFinanceAccessForAction(str(formData, "branchId"), "finance.concessions", "approve");
    const parsed = concessionSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await grantConcession(studentId, { amountMinor: parsed.data.amount, reason: parsed.data.reason, feeStructureId: parsed.data.feeStructureId }, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/students/${studentId}`);
  return { success: "Concession granted — it applies to the next invoice raised" };
}

// --- Invoices -------------------------------------------------------------------------

export async function raiseInvoiceAction(studentId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  let invoiceId: string;
  let created: boolean;
  let ctx: Ctx;
  try {
    const access = await requireFinanceAccessForAction(str(formData, "branchId"), "finance.invoices", "create");
    const parsed = raiseInvoiceSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    const r = await raiseInvoice(studentId, parsed.data.feeStructureId, parsed.data.dueDate, actorOf(access));
    invoiceId = r.invoice.id;
    created = r.created;
    ctx = access.ctx;
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/finance");
  if (!created) return { error: "This student already has an invoice for that structure" };
  redirect(withBranch(`/finance/invoices/${invoiceId}`, ctx as never));
}

export async function raiseForSectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireFinanceAccessForAction(str(formData, "branchId"), "finance.invoices", "create");
    const parsed = raiseForSectionSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    const r = await raiseInvoicesForSection(parsed.data.sectionId, parsed.data.feeStructureId, parsed.data.dueDate, actorOf(access));
    revalidatePath("/finance");
    revalidatePath("/finance/invoices");
    return { success: `Raised ${r.created} invoice${r.created === 1 ? "" : "s"}${r.skipped ? `, ${r.skipped} already existed` : ""} (${r.total} enrolled students)` };
  } catch (e) {
    return toFormState(e);
  }
}

export async function cancelInvoiceAction(invoiceId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireFinanceAccessForAction(str(formData, "branchId"), "finance.invoices", "edit");
    await cancelInvoice(invoiceId, str(formData, "reason") || undefined, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/finance/invoices/${invoiceId}`);
  revalidatePath("/finance");
  return { success: "Invoice cancelled" };
}

// --- Payments & refunds ------------------------------------------------------------

export async function recordPaymentAction(invoiceId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireFinanceAccessForAction(str(formData, "branchId"), "finance.payments", "pay");
    const parsed = paymentSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    const r = await recordPayment(invoiceId, { amountMinor: parsed.data.amount, method: parsed.data.method, paidAtISO: parsed.data.paidAt, reference: parsed.data.reference }, actorOf(access));
    revalidatePath(`/finance/invoices/${invoiceId}`);
    revalidatePath("/finance");
    revalidatePath("/finance/ledger");
    return { success: `Receipt ${r.receipt.receiptNumber} issued` };
  } catch (e) {
    return toFormState(e);
  }
}

export async function requestRefundAction(paymentId: string, invoiceId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireFinanceAccessForAction(str(formData, "branchId"), "finance.payments", "refund");
    const parsed = refundRequestSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await requestRefund(paymentId, { amountMinor: parsed.data.amount, reason: parsed.data.reason }, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/finance/invoices/${invoiceId}`);
  return { success: "Refund requested" };
}

export async function decideRefundAction(formData: FormData): Promise<void> {
  const refundId = str(formData, "refundId");
  const invoiceId = str(formData, "invoiceId");
  const decision = str(formData, "decision");
  if (!refundId || !invoiceId || !decision || !["APPROVED", "REJECTED", "PROCESSED"].includes(decision)) return;
  try {
    const access = await requireFinanceAccessForAction(str(formData, "branchId"), "finance.payments", "refund");
    await decideRefund(refundId, decision as "APPROVED" | "REJECTED" | "PROCESSED", actorOf(access));
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return;
    throw e;
  }
  revalidatePath(`/finance/invoices/${invoiceId}`);
  revalidatePath("/finance");
  revalidatePath("/finance/ledger");
}
