import { describe, expect, it } from "vitest";
import {
  allowedPayrollActions,
  computePayslip,
  isOnPayroll,
  isValidPeriod,
  nextPayrollStatus,
  periodLabel,
  summarizePayroll,
} from "@/modules/hr/payroll";

describe("computePayslip", () => {
  it("applies a percentage and a fixed amount, in minor units", () => {
    // ₹50,000 gross, 12% + ₹200 fixed
    const r = computePayslip({ grossMinor: 5_000_000, deductionPercent: 12, fixedDeductionMinor: 20_000 });
    expect(r.deductionsMinor).toBe(600_000 + 20_000);
    expect(r.netMinor).toBe(5_000_000 - 620_000);
    expect(r.grossMinor).toBe(r.deductionsMinor + r.netMinor);
  });

  it("rounds the percentage to whole minor units rather than carrying fractions", () => {
    const r = computePayslip({ grossMinor: 3_333_333, deductionPercent: 7.5, fixedDeductionMinor: 0 });
    expect(Number.isInteger(r.deductionsMinor)).toBe(true);
    expect(r.grossMinor).toBe(r.deductionsMinor + r.netMinor);
  });

  it("never lets net pay go negative", () => {
    const r = computePayslip({ grossMinor: 100_000, deductionPercent: 90, fixedDeductionMinor: 500_000 });
    expect(r.deductionsMinor).toBe(100_000);
    expect(r.netMinor).toBe(0);
  });

  it("clamps a nonsense percentage instead of trusting it", () => {
    expect(computePayslip({ grossMinor: 1000, deductionPercent: -5, fixedDeductionMinor: 0 }).deductionsMinor).toBe(0);
    expect(computePayslip({ grossMinor: 1000, deductionPercent: 500, fixedDeductionMinor: 0 }).deductionsMinor).toBe(1000);
  });
});

describe("summarizePayroll", () => {
  it("totals a run and stays internally consistent", () => {
    const t = summarizePayroll([
      { grossMinor: 5_000_000, deductionsMinor: 600_000, netMinor: 4_400_000 },
      { grossMinor: 3_000_000, deductionsMinor: 360_000, netMinor: 2_640_000 },
    ]);
    expect(t).toEqual({ grossMinor: 8_000_000, deductionsMinor: 960_000, netMinor: 7_040_000, count: 2 });
    expect(t.grossMinor).toBe(t.deductionsMinor + t.netMinor);
  });
});

describe("payroll lifecycle", () => {
  it("regenerates freely while draft, then freezes", () => {
    expect(nextPayrollStatus("DRAFT", "generate")).toBe("DRAFT");
    expect(nextPayrollStatus("DRAFT", "process")).toBe("PROCESSED");
    expect(nextPayrollStatus("PROCESSED", "generate")).toBeNull();
  });

  it("only a processed run can be paid, and paid is terminal", () => {
    expect(nextPayrollStatus("DRAFT", "pay")).toBeNull();
    expect(nextPayrollStatus("PROCESSED", "pay")).toBe("PAID");
    expect(allowedPayrollActions("PAID")).toEqual([]);
  });
});

describe("period helpers", () => {
  it("labels and validates periods", () => {
    expect(periodLabel(9, 2026)).toBe("September 2026");
    expect(isValidPeriod(9, 2026)).toBe(true);
    expect(isValidPeriod(13, 2026)).toBe(false);
    expect(isValidPeriod(0, 2026)).toBe(false);
  });

  it("excludes staff who joined after the period or left before it", () => {
    const sept = { month: 9, year: 2026 };
    expect(isOnPayroll({ joinDate: new Date("2026-01-01"), exitDate: null, ...sept })).toBe(true);
    // Joined on the last day of the month: still on this run.
    expect(isOnPayroll({ joinDate: new Date("2026-09-30"), exitDate: null, ...sept })).toBe(true);
    expect(isOnPayroll({ joinDate: new Date("2026-10-01"), exitDate: null, ...sept })).toBe(false);
    // Left during the month: still paid for it.
    expect(isOnPayroll({ joinDate: new Date("2020-01-01"), exitDate: new Date("2026-09-15"), ...sept })).toBe(true);
    expect(isOnPayroll({ joinDate: new Date("2020-01-01"), exitDate: new Date("2026-08-31"), ...sept })).toBe(false);
  });
});
