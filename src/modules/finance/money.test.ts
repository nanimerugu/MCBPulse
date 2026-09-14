import { describe, expect, it } from "vitest";
import {
  computeInvoice,
  deriveStatus,
  formatDocumentNumber,
  fromMinor,
  parseMoneyInput,
  paymentPosting,
  persistedStatus,
  refundPosting,
  toMinor,
} from "@/modules/finance/money";

describe("minor units", () => {
  it("round-trips Decimal strings without float drift", () => {
    expect(toMinor("1234.50")).toBe(123450);
    expect(toMinor("0.1")).toBe(10);
    expect(toMinor(1234.5)).toBe(123450);
    expect(toMinor({ toString: () => "99.99" })).toBe(9999);
    expect(fromMinor(123450)).toBe("1234.50");
    expect(fromMinor(5)).toBe("0.05");
    expect(fromMinor(-250)).toBe("-2.50");
    // 0.1 + 0.2 in minor units is exactly 0.30
    expect(fromMinor(toMinor("0.1") + toMinor("0.2"))).toBe("0.30");
  });

  it("rejects things that aren't money", () => {
    expect(() => toMinor("abc")).toThrow();
    expect(parseMoneyInput("₹ 1,234.5")).toBe(123450);
    expect(parseMoneyInput("12.345")).toBeNull();
    expect(parseMoneyInput("-5")).toBeNull();
  });
});

describe("computeInvoice", () => {
  it("sums lines and caps concessions at the gross", () => {
    expect(computeInvoice([500000, 120000], [50000])).toEqual({ grossMinor: 620000, concessionMinor: 50000, totalMinor: 570000 });
    expect(computeInvoice([100000], [150000, 20000])).toEqual({ grossMinor: 100000, concessionMinor: 100000, totalMinor: 0 });
  });
});

describe("status", () => {
  const due = new Date("2026-09-30T00:00:00.000Z");
  it("is pending, partial or paid before the due date", () => {
    expect(deriveStatus({ totalMinor: 1000, paidMinor: 0, dueDate: due, today: new Date("2026-09-14"), cancelled: false })).toBe("PENDING");
    expect(deriveStatus({ totalMinor: 1000, paidMinor: 400, dueDate: due, today: new Date("2026-09-14"), cancelled: false })).toBe("PARTIAL");
    expect(deriveStatus({ totalMinor: 1000, paidMinor: 1000, dueDate: due, today: new Date("2026-09-14"), cancelled: false })).toBe("PAID");
  });

  it("becomes overdue the day after the due date, unless paid or cancelled", () => {
    expect(deriveStatus({ totalMinor: 1000, paidMinor: 0, dueDate: due, today: new Date("2026-09-30T12:00:00Z"), cancelled: false })).toBe("PENDING");
    expect(deriveStatus({ totalMinor: 1000, paidMinor: 0, dueDate: due, today: new Date("2026-10-01T00:00:00Z"), cancelled: false })).toBe("OVERDUE");
    expect(deriveStatus({ totalMinor: 1000, paidMinor: 400, dueDate: due, today: new Date("2026-10-01"), cancelled: false })).toBe("OVERDUE");
    expect(deriveStatus({ totalMinor: 1000, paidMinor: 1000, dueDate: due, today: new Date("2026-10-01"), cancelled: false })).toBe("PAID");
    expect(deriveStatus({ totalMinor: 1000, paidMinor: 0, dueDate: due, today: new Date("2026-10-01"), cancelled: true })).toBe("CANCELLED");
  });

  it("never persists OVERDUE", () => {
    expect(persistedStatus({ totalMinor: 1000, paidMinor: 0, cancelled: false })).toBe("PENDING");
    expect(persistedStatus({ totalMinor: 1000, paidMinor: 1000, cancelled: false })).toBe("PAID");
  });
});

describe("postings and numbers", () => {
  it("debits the account the money arrived in and credits fee income; refunds reverse it", () => {
    expect(paymentPosting("CASH")).toEqual({ debit: "1000", credit: "4000" });
    expect(paymentPosting("BANK_TRANSFER")).toEqual({ debit: "1010", credit: "4000" });
    expect(refundPosting("CASH")).toEqual({ debit: "4000", credit: "1000" });
  });

  it("formats document numbers with a zero-padded sequence", () => {
    expect(formatDocumentNumber("INV", 2026, 7)).toBe("INV-2026-00007");
  });
});
