"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError } from "@/lib/rbac";
import { actorOf, requireOpsAccessForAction, str, type ModuleAccess } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { fieldErrors } from "@/modules/sis/schemas";
import { SisError } from "@/modules/sis/students.service";
import { formatMoney, parseMoneyInput } from "@/modules/finance/money";
import { addMenuItem, openAccount, recordSale, recordTransaction, setAccountActive, type CanteenScope } from "@/modules/canteen/canteen.service";

function toFormState(error: unknown): FormState {
  if (error instanceof SisError || error instanceof ForbiddenError) return { error: error.message };
  throw error;
}
function values(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
function scopeOf(access: ModuleAccess): CanteenScope {
  return { organizationId: access.ctx.organizationId, branchId: access.ctx.branch.id };
}

export async function addMenuItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.canteen", "configure");
    const parsed = z.object({ name: z.string().trim().min(1, "Name is required").max(80), price: z.string().min(1, "Price is required") }).safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    const priceMinor = parseMoneyInput(parsed.data.price);
    if (priceMinor === null) return { fieldErrors: { price: "Enter an amount like 40 or 40.50" } };
    await addMenuItem({ name: parsed.data.name, priceMinor }, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/operations/canteen");
  return { success: "Added to the menu" };
}

export async function openAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.canteen", "pay");
    const studentId = str(formData, "studentId");
    if (!studentId) return { error: "Choose a student" };
    await openAccount(studentId, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/operations/canteen");
  return { success: "Wallet opened" };
}

export async function topUpAction(accountId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  let balanceAfter: number;
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.canteen", "pay");
    const raw = str(formData, "amount") ?? "";
    const amountMinor = parseMoneyInput(raw);
    if (amountMinor === null || amountMinor <= 0) return { fieldErrors: { amount: "Enter an amount like 500" } };
    ({ balanceAfter } = await recordTransaction(
      accountId,
      { kind: "TOP_UP", amountMinor, note: str(formData, "note") || undefined },
      scopeOf(access),
      actorOf(access),
    ));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/operations/canteen/${accountId}`);
  revalidatePath("/operations/canteen");
  return { success: `Topped up — balance ${formatMoney(balanceAfter)}` };
}

export async function setActiveAction(accountId: string, active: boolean, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.canteen", "pay");
    await setAccountActive(accountId, active, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/operations/canteen/${accountId}`);
  return { success: active ? "Wallet unfrozen" : "Wallet frozen — top-ups still work, purchases don't" };
}

/**
 * The till. The basket carries item ids and quantities only — prices are
 * read from the menu server-side, so a tampered form cannot set them.
 */
export async function sellAction(accountId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  let result: { totalMinor: number; balanceAfter: number };
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.canteen", "pay");
    const basket: { canteenItemId: string; quantity: number }[] = [];
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("qty_") || typeof value !== "string") continue;
      const quantity = Number(value);
      if (Number.isInteger(quantity) && quantity > 0) basket.push({ canteenItemId: key.slice(4), quantity });
    }
    if (basket.length === 0) return { error: "Nothing in the basket" };
    const sale = await recordSale(accountId, basket, scopeOf(access), actorOf(access));
    result = { totalMinor: sale.totalMinor, balanceAfter: sale.balanceAfter };
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/operations/canteen/${accountId}`);
  revalidatePath("/operations/canteen");
  return { success: `Sold ${formatMoney(result.totalMinor)} — balance ${formatMoney(result.balanceAfter)}` };
}
