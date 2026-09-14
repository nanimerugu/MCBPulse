import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { CanteenTransactionKind } from "@/generated/prisma/enums";
import { fromMinor, toMinor } from "@/modules/finance/money";
import { basketTotal, checkMovement } from "@/modules/canteen/wallet";
import { SisError, type Actor } from "@/modules/sis/students.service";

export interface CanteenScope {
  organizationId: string;
  branchId: string;
}

// --- Menu --------------------------------------------------------------------

export async function listMenu(scope: CanteenScope) {
  return db.canteenItem.findMany({ where: { branchId: scope.branchId, deletedAt: null }, orderBy: { name: "asc" } });
}

export async function addMenuItem(input: { name: string; priceMinor: number }, scope: CanteenScope, actor: Actor) {
  if (input.priceMinor <= 0) throw new SisError("A price must be more than zero");
  const clash = await db.canteenItem.findFirst({ where: { branchId: scope.branchId, name: input.name, deletedAt: null } });
  if (clash) throw new SisError(`"${input.name}" is already on the menu`);

  const item = await db.canteenItem.create({ data: { branchId: scope.branchId, name: input.name, price: fromMinor(input.priceMinor) } });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "canteen_item.created",
    resourceType: "canteen_item",
    resourceId: item.id,
    after: { name: input.name, priceMinor: input.priceMinor },
  });
  return item;
}

// --- Wallets -----------------------------------------------------------------

export async function listAccounts(scope: CanteenScope) {
  return db.canteenAccount.findMany({
    where: { student: { organizationId: scope.organizationId, branchId: scope.branchId, deletedAt: null } },
    include: { student: { include: { currentSection: { include: { grade: true } } } } },
    orderBy: { student: { firstName: "asc" } },
  });
}

export async function getAccount(accountId: string, scope: CanteenScope) {
  return db.canteenAccount.findFirst({
    where: { id: accountId, student: { organizationId: scope.organizationId, branchId: scope.branchId, deletedAt: null } },
    include: {
      student: { include: { currentSection: { include: { grade: true } } } },
      transactions: { orderBy: { createdAt: "desc" }, take: 50 },
      sales: { include: { lines: { include: { canteenItem: true } } }, orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
}

/** Opens a wallet for a student, or returns the one they already have. */
export async function openAccount(studentId: string, scope: CanteenScope, actor: Actor) {
  const student = await db.student.findFirst({
    where: { id: studentId, organizationId: scope.organizationId, branchId: scope.branchId, deletedAt: null },
  });
  if (!student) throw new SisError("Student not found");

  const existing = await db.canteenAccount.findUnique({ where: { studentId } });
  if (existing) return existing;

  const account = await db.canteenAccount.create({ data: { studentId } });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "canteen_account.opened",
    resourceType: "student",
    resourceId: studentId,
    after: { accountId: account.id },
  });
  return account;
}

/**
 * Moves the wallet and writes the ledger row in one transaction, with the
 * balance check re-applied as a CONDITIONAL update — same pattern as the
 * library's last copy. Two tills serving the same child at once must not be
 * able to drive the balance below zero between the check and the write.
 */
export async function recordTransaction(
  accountId: string,
  input: { kind: CanteenTransactionKind; amountMinor: number; note?: string; saleId?: string },
  scope: CanteenScope,
  actor: Actor,
) {
  const account = await db.canteenAccount.findFirst({
    where: { id: accountId, student: { organizationId: scope.organizationId, branchId: scope.branchId, deletedAt: null } },
    include: { student: true },
  });
  if (!account) throw new SisError("Wallet not found");

  const balanceMinor = toMinor(account.balance);
  const check = checkMovement({ kind: input.kind, amountMinor: input.amountMinor, balanceMinor, active: account.active });
  if (!check.ok) throw new SisError(check.message);
  const { delta, balanceAfter } = check;

  await db.$transaction(async (tx) => {
    const moved = await tx.canteenAccount.updateMany({
      // Only apply if the balance is still what the decision was based on.
      where: { id: accountId, balance: account.balance },
      data: { balance: fromMinor(balanceAfter) },
    });
    if (moved.count === 0) throw new SisError("The balance changed while you were recording this — check it and try again");

    await tx.canteenTransaction.create({
      data: {
        accountId,
        saleId: input.saleId ?? null,
        kind: input.kind,
        amount: fromMinor(delta),
        balanceAfter: fromMinor(balanceAfter),
        note: input.note ?? null,
        recordedByUserId: actor.userId,
      },
    });
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "canteen_wallet.moved",
    resourceType: "student",
    resourceId: account.studentId,
    before: { balanceMinor },
    after: { kind: input.kind, delta, balanceAfter, note: input.note ?? null },
  });

  return { balanceAfter };
}

export async function setAccountActive(accountId: string, active: boolean, scope: CanteenScope, actor: Actor) {
  const account = await db.canteenAccount.findFirst({
    where: { id: accountId, student: { organizationId: scope.organizationId, branchId: scope.branchId, deletedAt: null } },
  });
  if (!account) throw new SisError("Wallet not found");

  await db.canteenAccount.update({ where: { id: accountId }, data: { active } });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: active ? "canteen_account.unfrozen" : "canteen_account.frozen",
    resourceType: "student",
    resourceId: account.studentId,
    after: { accountId, active },
  });
}

/**
 * The till. Prices are read from the menu server-side and copied onto the
 * sale lines — the basket sends item ids and quantities, never prices, so a
 * tampered form cannot sell a ₹40 sandwich for ₹1.
 */
export async function recordSale(
  accountId: string,
  basket: { canteenItemId: string; quantity: number }[],
  scope: CanteenScope,
  actor: Actor,
) {
  const wanted = basket.filter((b) => b.quantity > 0);
  if (wanted.length === 0) throw new SisError("Nothing in the basket");

  const items = await db.canteenItem.findMany({
    where: { id: { in: wanted.map((b) => b.canteenItemId) }, branchId: scope.branchId, deletedAt: null },
  });
  if (items.length !== new Set(wanted.map((b) => b.canteenItemId)).size) throw new SisError("An item isn't on this branch's menu");

  const byId = new Map(items.map((i) => [i.id, i]));
  const lines = wanted.map((b) => {
    const item = byId.get(b.canteenItemId)!;
    const unitPriceMinor = toMinor(item.price);
    return { canteenItemId: item.id, quantity: Math.trunc(b.quantity), unitPriceMinor, lineTotalMinor: Math.trunc(b.quantity) * unitPriceMinor };
  });
  const totalMinor = basketTotal(lines.map((l) => ({ quantity: l.quantity, unitPriceMinor: l.unitPriceMinor })));

  const account = await db.canteenAccount.findFirst({
    where: { id: accountId, student: { organizationId: scope.organizationId, branchId: scope.branchId, deletedAt: null } },
    include: { student: true },
  });
  if (!account) throw new SisError("Wallet not found");

  // Check before creating the sale, so a refused purchase leaves no orphan.
  const check = checkMovement({ kind: "PURCHASE", amountMinor: totalMinor, balanceMinor: toMinor(account.balance), active: account.active });
  if (!check.ok) throw new SisError(check.message);

  const sale = await db.canteenSale.create({
    data: {
      accountId,
      total: fromMinor(totalMinor),
      soldByUserId: actor.userId,
      lines: {
        create: lines.map((l) => ({
          canteenItemId: l.canteenItemId,
          quantity: l.quantity,
          unitPrice: fromMinor(l.unitPriceMinor),
          lineTotal: fromMinor(l.lineTotalMinor),
        })),
      },
    },
  });

  try {
    const { balanceAfter } = await recordTransaction(
      accountId,
      { kind: "PURCHASE", amountMinor: totalMinor, note: `${lines.length} item${lines.length === 1 ? "" : "s"}`, saleId: sale.id },
      scope,
      actor,
    );
    return { saleId: sale.id, totalMinor, balanceAfter };
  } catch (e) {
    // If the wallet move lost a race, the sale never happened.
    await db.canteenSale.delete({ where: { id: sale.id } }).catch(() => {});
    throw e;
  }
}
