import type { StockMovementKind } from "@/generated/prisma/enums";

/**
 * Inventory movements (blueprint Phase 8 "inventory / store"). The schema
 * carries `InventoryItem.quantityOnHand`, a single number with no account of
 * how it got there. Phase 8 adds a StockMovement ledger behind it, for the
 * same reason Finance has a journal: a quantity nobody can explain is a
 * quantity nobody can trust, and "the count is wrong" is unanswerable
 * without the movements.
 *
 * quantityOnHand stays as the running total (the read path is a stock list,
 * and summing every movement on every page load would be silly), but it is
 * only ever moved by applying a movement, never set directly.
 */

/** How much each kind of movement changes quantity on hand. */
export function signedQuantity(kind: StockMovementKind, quantity: number): number {
  const magnitude = Math.abs(Math.trunc(quantity));
  switch (kind) {
    case "RECEIPT":
      return magnitude;
    case "ISSUE":
    case "WRITE_OFF":
      return -magnitude;
    case "ADJUSTMENT":
      // The only kind that carries its own direction: a stock-take can
      // correct in either direction, so the sign of the input is kept.
      return Math.trunc(quantity);
  }
}

export const MOVEMENT_LABELS: Record<StockMovementKind, string> = {
  RECEIPT: "Received",
  ISSUE: "Issued",
  WRITE_OFF: "Written off",
  ADJUSTMENT: "Stock-take adjustment",
};

export const MOVEMENT_KINDS: StockMovementKind[] = ["RECEIPT", "ISSUE", "WRITE_OFF", "ADJUSTMENT"];

export type StockCheck = { ok: true; delta: number; resulting: number } | { ok: false; message: string };

/**
 * Stock can't go negative. A school that has issued more than it holds has
 * a counting error, and letting the number go below zero hides it instead of
 * surfacing it.
 */
export function checkMovement(args: { kind: StockMovementKind; quantity: number; quantityOnHand: number }): StockCheck {
  if (!Number.isInteger(args.quantity)) return { ok: false, message: "Quantity must be a whole number" };
  if (args.quantity === 0) return { ok: false, message: "Quantity must not be zero" };
  if (args.kind !== "ADJUSTMENT" && args.quantity < 0) return { ok: false, message: "Quantity must be positive — the movement kind sets the direction" };

  const delta = signedQuantity(args.kind, args.quantity);
  const resulting = args.quantityOnHand + delta;
  if (resulting < 0) {
    return { ok: false, message: `Only ${args.quantityOnHand} in stock — that movement would leave ${resulting}` };
  }
  return { ok: true, delta, resulting };
}

export function isBelowReorderLevel(item: { quantityOnHand: number; reorderLevel: number }): boolean {
  return item.reorderLevel > 0 && item.quantityOnHand <= item.reorderLevel;
}
