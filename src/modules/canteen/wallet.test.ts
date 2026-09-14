import { describe, expect, it } from "vitest";
import { basketTotal, checkMovement, isLowBalance, lineTotal, signedAmount } from "@/modules/canteen/wallet";

describe("signedAmount", () => {
  it("adds on top-up and refund, subtracts on purchase", () => {
    expect(signedAmount("TOP_UP", 10_000)).toBe(10_000);
    expect(signedAmount("REFUND", 2_500)).toBe(2_500);
    expect(signedAmount("PURCHASE", 4_000)).toBe(-4_000);
  });

  it("ignores a stray sign on kinds that imply direction", () => {
    expect(signedAmount("PURCHASE", -4_000)).toBe(-4_000);
    expect(signedAmount("TOP_UP", -10_000)).toBe(10_000);
  });

  it("respects the sign of an adjustment", () => {
    expect(signedAmount("ADJUSTMENT", -300)).toBe(-300);
    expect(signedAmount("ADJUSTMENT", 300)).toBe(300);
  });
});

describe("checkMovement", () => {
  const active = { balanceMinor: 10_000, active: true };

  it("allows a top-up and reports the new balance", () => {
    expect(checkMovement({ kind: "TOP_UP", amountMinor: 5_000, ...active })).toEqual({ ok: true, delta: 5_000, balanceAfter: 15_000 });
  });

  it("allows spending down to exactly zero", () => {
    expect(checkMovement({ kind: "PURCHASE", amountMinor: 10_000, ...active })).toEqual({ ok: true, delta: -10_000, balanceAfter: 0 });
  });

  it("REFUSES to let a wallet go negative — a canteen is not a credit facility", () => {
    const r = checkMovement({ kind: "PURCHASE", amountMinor: 10_001, ...active });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("₹100.00");
      expect(r.message).toContain("₹100.01");
    }
  });

  it("refuses a purchase on a frozen wallet but still allows a top-up", () => {
    expect(checkMovement({ kind: "PURCHASE", amountMinor: 100, balanceMinor: 10_000, active: false }).ok).toBe(false);
    expect(checkMovement({ kind: "TOP_UP", amountMinor: 100, balanceMinor: 10_000, active: false }).ok).toBe(true);
  });

  it("refuses a negative correction that overshoots", () => {
    expect(checkMovement({ kind: "ADJUSTMENT", amountMinor: -10_001, ...active }).ok).toBe(false);
    expect(checkMovement({ kind: "ADJUSTMENT", amountMinor: -10_000, ...active }).ok).toBe(true);
  });

  it("rejects zero, fractional and wrongly-signed amounts", () => {
    expect(checkMovement({ kind: "TOP_UP", amountMinor: 0, ...active }).ok).toBe(false);
    expect(checkMovement({ kind: "TOP_UP", amountMinor: 10.5, ...active }).ok).toBe(false);
    expect(checkMovement({ kind: "TOP_UP", amountMinor: -100, ...active }).ok).toBe(false);
  });
});

describe("basket arithmetic", () => {
  it("multiplies quantity by unit price in minor units", () => {
    expect(lineTotal({ quantity: 3, unitPriceMinor: 2_500 })).toBe(7_500);
  });

  it("treats a negative quantity as zero rather than crediting the basket", () => {
    expect(lineTotal({ quantity: -3, unitPriceMinor: 2_500 })).toBe(0);
  });

  it("totals a basket exactly, with no floating point drift", () => {
    const lines = [
      { quantity: 3, unitPriceMinor: 3_333 },
      { quantity: 1, unitPriceMinor: 1 },
    ];
    expect(basketTotal(lines)).toBe(10_000);
    expect(Number.isInteger(basketTotal(lines))).toBe(true);
  });

  it("is zero for an empty basket", () => {
    expect(basketTotal([])).toBe(0);
  });
});

describe("isLowBalance", () => {
  it("flags under ₹50", () => {
    expect(isLowBalance(4_999)).toBe(true);
    expect(isLowBalance(5_000)).toBe(false);
  });
});
