import { describe, expect, it } from "vitest";
import { checkMovement, isBelowReorderLevel, signedQuantity } from "@/modules/operations/stock";

describe("signedQuantity", () => {
  it("adds on receipt and subtracts on issue and write-off", () => {
    expect(signedQuantity("RECEIPT", 10)).toBe(10);
    expect(signedQuantity("ISSUE", 4)).toBe(-4);
    expect(signedQuantity("WRITE_OFF", 2)).toBe(-2);
  });

  it("ignores a stray sign on kinds that set their own direction", () => {
    expect(signedQuantity("ISSUE", -4)).toBe(-4);
    expect(signedQuantity("RECEIPT", -10)).toBe(10);
  });

  it("keeps the sign for an adjustment, which can go either way", () => {
    expect(signedQuantity("ADJUSTMENT", 3)).toBe(3);
    expect(signedQuantity("ADJUSTMENT", -3)).toBe(-3);
  });
});

describe("checkMovement", () => {
  it("accepts a receipt and reports the resulting level", () => {
    expect(checkMovement({ kind: "RECEIPT", quantity: 10, quantityOnHand: 5 })).toEqual({ ok: true, delta: 10, resulting: 15 });
  });

  it("accepts an issue down to exactly zero", () => {
    expect(checkMovement({ kind: "ISSUE", quantity: 5, quantityOnHand: 5 })).toEqual({ ok: true, delta: -5, resulting: 0 });
  });

  it("refuses to drive stock negative, and says what is actually held", () => {
    const r = checkMovement({ kind: "ISSUE", quantity: 6, quantityOnHand: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("Only 5 in stock");
  });

  it("refuses a negative stock-take correction that overshoots", () => {
    expect(checkMovement({ kind: "ADJUSTMENT", quantity: -6, quantityOnHand: 5 }).ok).toBe(false);
    expect(checkMovement({ kind: "ADJUSTMENT", quantity: -5, quantityOnHand: 5 }).ok).toBe(true);
  });

  it("rejects zero and fractional quantities", () => {
    expect(checkMovement({ kind: "RECEIPT", quantity: 0, quantityOnHand: 5 }).ok).toBe(false);
    expect(checkMovement({ kind: "RECEIPT", quantity: 2.5, quantityOnHand: 5 }).ok).toBe(false);
  });

  it("rejects a negative quantity on a kind whose direction is implied", () => {
    const r = checkMovement({ kind: "ISSUE", quantity: -2, quantityOnHand: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/movement kind sets the direction/);
  });
});

describe("isBelowReorderLevel", () => {
  it("flags at or below the level, and not when no level is set", () => {
    expect(isBelowReorderLevel({ quantityOnHand: 3, reorderLevel: 5 })).toBe(true);
    expect(isBelowReorderLevel({ quantityOnHand: 5, reorderLevel: 5 })).toBe(true);
    expect(isBelowReorderLevel({ quantityOnHand: 6, reorderLevel: 5 })).toBe(false);
    expect(isBelowReorderLevel({ quantityOnHand: 0, reorderLevel: 0 })).toBe(false);
  });
});
