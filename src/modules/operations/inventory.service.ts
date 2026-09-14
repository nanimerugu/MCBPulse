import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { StockMovementKind } from "@/generated/prisma/enums";
import { checkMovement } from "@/modules/operations/stock";
import { SisError, type Actor } from "@/modules/sis/students.service";
import type { OpsScope } from "@/modules/operations/library.service";

export async function listInventoryItems(scope: OpsScope) {
  return db.inventoryItem.findMany({
    where: { branchId: scope.branchId, deletedAt: null },
    orderBy: { name: "asc" },
    take: 200,
  });
}

export async function getInventoryItem(itemId: string, scope: OpsScope) {
  return db.inventoryItem.findFirst({
    where: { id: itemId, branchId: scope.branchId, deletedAt: null },
    include: { movements: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
}

export async function createInventoryItem(
  input: { name: string; sku: string; unit: string; openingQuantity: number; reorderLevel: number },
  scope: OpsScope,
  actor: Actor,
) {
  if (input.openingQuantity < 0) throw new SisError("Opening stock can't be negative");
  if (input.reorderLevel < 0) throw new SisError("Reorder level can't be negative");

  const clash = await db.inventoryItem.findFirst({ where: { branchId: scope.branchId, sku: input.sku, deletedAt: null } });
  if (clash) throw new SisError(`SKU "${input.sku}" already exists at this branch`);

  // Opening stock is itself a movement, so even the first number has a
  // reason attached rather than appearing from nowhere.
  const item = await db.$transaction(async (tx) => {
    const created = await tx.inventoryItem.create({
      data: {
        branchId: scope.branchId,
        name: input.name,
        sku: input.sku,
        unit: input.unit,
        quantityOnHand: input.openingQuantity,
        reorderLevel: input.reorderLevel,
      },
    });
    if (input.openingQuantity > 0) {
      await tx.stockMovement.create({
        data: {
          inventoryItemId: created.id,
          kind: "RECEIPT",
          quantity: input.openingQuantity,
          quantityAfter: input.openingQuantity,
          note: "Opening stock",
          recordedByUserId: actor.userId,
        },
      });
    }
    return created;
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "inventory_item.created",
    resourceType: "inventory_item",
    resourceId: item.id,
    after: { name: input.name, sku: input.sku, openingQuantity: input.openingQuantity },
  });
  return item;
}

/**
 * Record a movement and move the running total in the same transaction, so a
 * quantity can never exist without a movement explaining it.
 *
 * The decrement is conditional (`quantityOnHand: { gte: magnitude }`) for the
 * same reason the library's is: two people issuing the last of something at
 * once must not drive stock negative. Zero rows updated means we lost the
 * race and the caller is told so rather than being given a wrong number.
 */
export async function recordStockMovement(
  itemId: string,
  input: { kind: StockMovementKind; quantity: number; note?: string },
  scope: OpsScope,
  actor: Actor,
) {
  const item = await db.inventoryItem.findFirst({ where: { id: itemId, branchId: scope.branchId, deletedAt: null } });
  if (!item) throw new SisError("Item not found");

  const check = checkMovement({ kind: input.kind, quantity: input.quantity, quantityOnHand: item.quantityOnHand });
  if (!check.ok) throw new SisError(check.message);
  const { delta, resulting } = check;

  await db.$transaction(async (tx) => {
    const moved = await tx.inventoryItem.updateMany({
      // Only apply if the level is still what we based the decision on.
      where: { id: itemId, quantityOnHand: delta < 0 ? { gte: -delta } : undefined },
      data: { quantityOnHand: { increment: delta } },
    });
    if (moved.count === 0) throw new SisError("Stock changed while you were recording this — check the level and try again");

    const after = await tx.inventoryItem.findUniqueOrThrow({ where: { id: itemId }, select: { quantityOnHand: true } });
    await tx.stockMovement.create({
      data: {
        inventoryItemId: itemId,
        kind: input.kind,
        quantity: delta,
        quantityAfter: after.quantityOnHand,
        note: input.note ?? null,
        recordedByUserId: actor.userId,
      },
    });
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "inventory_item.moved",
    resourceType: "inventory_item",
    resourceId: itemId,
    before: { quantityOnHand: item.quantityOnHand },
    after: { kind: input.kind, delta, quantityOnHand: resulting, note: input.note ?? null },
  });
  return { resulting };
}
