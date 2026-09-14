import type { CanteenTransactionKind } from "@/generated/prisma/enums";

/**
 * Canteen wallet arithmetic. Money in integer minor units, like everything
 * else that touches money here.
 *
 * The rule that matters: a wallet cannot go negative. A canteen is not a
 * credit facility, and a child who has run out should be told at the till,
 * not discover a debt at the end of term. The same shape as the inventory
 * stock guard, for the same reason.
 */

export interface WalletMovement {
  kind: CanteenTransactionKind;
  /** Always positive; the kind decides the direction (except ADJUSTMENT). */
  amountMinor: number;
}

export function signedAmount(kind: CanteenTransactionKind, amountMinor: number): number {
  const magnitude = Math.abs(Math.trunc(amountMinor));
  switch (kind) {
    case "TOP_UP":
    case "REFUND":
      return magnitude;
    case "PURCHASE":
      return -magnitude;
    case "ADJUSTMENT":
      // A correction can go either way, so its sign is respected.
      return Math.trunc(amountMinor);
  }
}

export type WalletCheck = { ok: true; delta: number; balanceAfter: number } | { ok: false; message: string };

export function checkMovement(args: { kind: CanteenTransactionKind; amountMinor: number; balanceMinor: number; active: boolean }): WalletCheck {
  if (!Number.isInteger(args.amountMinor)) return { ok: false, message: "Amount must be a whole number of paise" };
  if (args.amountMinor === 0) return { ok: false, message: "Amount must not be zero" };
  if (args.kind !== "ADJUSTMENT" && args.amountMinor < 0) return { ok: false, message: "Amount must be positive — the kind sets the direction" };
  if (!args.active && args.kind === "PURCHASE") return { ok: false, message: "This wallet is frozen" };

  const delta = signedAmount(args.kind, args.amountMinor);
  const balanceAfter = args.balanceMinor + delta;
  if (balanceAfter < 0) {
    return { ok: false, message: `Not enough in the wallet — the balance is ${formatMinor(args.balanceMinor)} and this needs ${formatMinor(-delta)}` };
  }
  return { ok: true, delta, balanceAfter };
}

export interface BasketLine {
  quantity: number;
  unitPriceMinor: number;
}

export function lineTotal(line: BasketLine): number {
  return Math.max(0, Math.trunc(line.quantity)) * line.unitPriceMinor;
}

export function basketTotal(lines: readonly BasketLine[]): number {
  return lines.reduce((s, l) => s + lineTotal(l), 0);
}

export const TRANSACTION_LABELS: Record<CanteenTransactionKind, string> = {
  TOP_UP: "Top-up",
  PURCHASE: "Purchase",
  REFUND: "Refund",
  ADJUSTMENT: "Adjustment",
};

export const LOW_BALANCE_MINOR = 5_000; // ₹50

export function isLowBalance(balanceMinor: number): boolean {
  return balanceMinor < LOW_BALANCE_MINOR;
}

function formatMinor(minor: number): string {
  return `₹${(minor / 100).toFixed(2)}`;
}
