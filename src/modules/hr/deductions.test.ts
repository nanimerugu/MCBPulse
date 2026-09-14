import { describe, expect, it } from "vitest";
import { checkRule, computeSlip, payableDays, prorate, type DeductionRule, type SlipInput } from "@/modules/hr/deductions";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const SEPT = { month: 9, year: 2026 }; // 30 days
const FULL = { daysInPeriod: 30, payableDays: 30, lossOfPayDays: 0 };

const rule = (over: Partial<DeductionRule> & { code: string; basis: DeductionRule["basis"] }): DeductionRule => ({
  id: over.code,
  name: over.code,
  employeePercent: null,
  employerPercent: null,
  fixedMinor: null,
  wageCeilingMinor: null,
  grossEligibilityMaxMinor: null,
  ...over,
});

const slip = (over: Partial<SlipInput>): SlipInput => ({
  monthlyGrossMinor: 5_000_000, // ₹50,000
  monthlyBasicMinor: 2_500_000, // ₹25,000
  days: FULL,
  rules: [],
  declaredMinor: new Map(),
  runPercent: 0,
  runFixedMinor: 0,
  ...over,
});

describe("payableDays", () => {
  it("pays a full month to someone employed throughout with no unpaid leave", () => {
    expect(payableDays({ joinDate: d("2020-01-01"), exitDate: null, ...SEPT, unpaidLeave: [] })).toEqual({ daysInPeriod: 30, employedDays: 30, lossOfPayDays: 0, payableDays: 30 });
  });

  it("prorates a joiner and a leaver by calendar days, both ends inclusive", () => {
    expect(payableDays({ joinDate: d("2026-09-21"), exitDate: null, ...SEPT, unpaidLeave: [] }).payableDays).toBe(10);
    expect(payableDays({ joinDate: d("2020-01-01"), exitDate: d("2026-09-10"), ...SEPT, unpaidLeave: [] }).payableDays).toBe(10);
  });

  it("docks unpaid leave once, even when two requests overlap", () => {
    const r = payableDays({ joinDate: d("2020-01-01"), exitDate: null, ...SEPT, unpaidLeave: [{ from: d("2026-09-10"), to: d("2026-09-14") }, { from: d("2026-09-13"), to: d("2026-09-16") }] });
    expect(r.lossOfPayDays).toBe(7); // 10th–16th
    expect(r.payableDays).toBe(23);
  });

  it("only counts unpaid leave inside the month and inside employment", () => {
    const r = payableDays({ joinDate: d("2020-01-01"), exitDate: d("2026-09-20"), ...SEPT, unpaidLeave: [{ from: d("2026-08-28"), to: d("2026-09-02") }, { from: d("2026-09-19"), to: d("2026-09-25") }] });
    expect(r.employedDays).toBe(20);
    expect(r.lossOfPayDays).toBe(2 + 2); // 1st–2nd, and 19th–20th
    expect(r.payableDays).toBe(16);
  });

  it("is zero outside employment", () => {
    expect(payableDays({ joinDate: d("2026-10-01"), exitDate: null, ...SEPT, unpaidLeave: [] }).payableDays).toBe(0);
  });
});

describe("prorate", () => {
  it("rounds to whole minor units and pays in full for a full month", () => {
    expect(prorate(5_000_000, 23, 30)).toBe(3_833_333);
    expect(prorate(5_000_000, 30, 30)).toBe(5_000_000);
    expect(prorate(5_000_000, 0, 30)).toBe(0);
  });
});

describe("computeSlip", () => {
  it("with no rules and no run deduction, net is gross", () => {
    const r = computeSlip(slip({}));
    expect(r).toMatchObject({ grossMinor: 5_000_000, deductionsMinor: 0, netMinor: 5_000_000, employerMinor: 0 });
  });

  it("applies a percentage of basic, capped at the wage ceiling, with employer share kept apart", () => {
    const pf = rule({ code: "PF", basis: "PERCENT_OF_BASIC", employeePercent: 12, employerPercent: 12, wageCeilingMinor: 1_500_000 });
    const r = computeSlip(slip({ rules: [pf] }));
    expect(r.deductionsMinor).toBe(180_000); // 12% of ₹15,000, not of ₹25,000
    expect(r.employerMinor).toBe(180_000);
    expect(r.netMinor).toBe(5_000_000 - 180_000); // employer share never reduces net
    expect(r.lines.find((l) => l.kind === "DEDUCTION")?.detail).toMatch(/capped/);
  });

  it("skips a gross-threshold rule for someone above it, and says why", () => {
    const esi = rule({ code: "ESI", basis: "PERCENT_OF_GROSS", employeePercent: 0.75, grossEligibilityMaxMinor: 2_100_000 });
    const r = computeSlip(slip({ rules: [esi] }));
    expect(r.deductionsMinor).toBe(0);
    expect(r.skipped).toEqual([{ code: "ESI", reason: expect.stringMatching(/above ₹21,000/) }]);
    const under = computeSlip(slip({ monthlyGrossMinor: 1_800_000, rules: [esi] }));
    expect(under.deductionsMinor).toBe(13_500);
  });

  it("judges eligibility on FULL monthly gross, not on a prorated month", () => {
    const esi = rule({ code: "ESI", basis: "PERCENT_OF_GROSS", employeePercent: 0.75, grossEligibilityMaxMinor: 2_100_000 });
    // ₹30,000/month with half the month unpaid: prorated gross ₹15,000 is
    // under the line, but the person is not in the scheme.
    const r = computeSlip(slip({ monthlyGrossMinor: 3_000_000, days: { daysInPeriod: 30, payableDays: 15, lossOfPayDays: 15 }, rules: [esi] }));
    expect(r.deductionsMinor).toBe(0);
  });

  it("prorates gross for loss of pay and applies percentages to the prorated base", () => {
    const pf = rule({ code: "PF", basis: "PERCENT_OF_BASIC", employeePercent: 12 });
    const r = computeSlip(slip({ days: { daysInPeriod: 30, payableDays: 27, lossOfPayDays: 3 }, rules: [pf] }));
    expect(r.grossMinor).toBe(4_500_000);
    expect(r.deductionsMinor).toBe(270_000); // 12% of prorated basic ₹22,500
    const lop = r.lines.find((l) => l.kind === "LOSS_OF_PAY")!;
    expect(lop.amountMinor).toBe(500_000);
    expect(lop.detail).toMatch(/27 of 30 days paid \(3 days unpaid leave\)/);
  });

  it("skips a basic-pay rule when basic isn't set, rather than guessing from gross", () => {
    const pf = rule({ code: "PF", basis: "PERCENT_OF_BASIC", employeePercent: 12 });
    const r = computeSlip(slip({ monthlyBasicMinor: null, rules: [pf] }));
    expect(r.deductionsMinor).toBe(0);
    expect(r.skipped[0]).toEqual({ code: "PF", reason: "basic pay isn't set for this person" });
  });

  it("uses a declared amount when there is one, and skips visibly when there isn't", () => {
    const tds = rule({ code: "TDS", basis: "DECLARED" });
    expect(computeSlip(slip({ rules: [tds], declaredMinor: new Map([["TDS", 420_000]]) })).deductionsMinor).toBe(420_000);
    expect(computeSlip(slip({ rules: [tds] })).skipped[0]!.reason).toMatch(/no amount declared/);
  });

  it("never takes net pay below zero, and marks the line that was reduced", () => {
    const loan = rule({ code: "LOAN", basis: "FIXED", fixedMinor: 4_000_000 });
    const pt = rule({ code: "PT", basis: "FIXED", fixedMinor: 20_000 });
    const r = computeSlip(slip({ monthlyGrossMinor: 3_000_000, monthlyBasicMinor: null, rules: [loan, pt] }));
    expect(r.netMinor).toBe(0);
    expect(r.deductionsMinor).toBe(3_000_000);
    expect(r.lines.find((l) => l.code === "LOAN")!.detail).toMatch(/reduced/);
    expect(r.skipped.some((s) => s.code === "PT")).toBe(true);
    expect(r.grossMinor).toBe(r.deductionsMinor + r.netMinor);
  });

  it("still applies the run's own flat deduction, last", () => {
    const pt = rule({ code: "PT", basis: "FIXED", fixedMinor: 20_000 });
    const r = computeSlip(slip({ rules: [pt], runPercent: 1, runFixedMinor: 5_000 }));
    expect(r.deductionsMinor).toBe(20_000 + 50_000 + 5_000);
    expect(r.lines.at(-1)!.code).toBe("OTHER");
  });
});

describe("checkRule", () => {
  const base = { name: "Provident fund", employeePercent: null, employerPercent: null, fixedMinor: null, wageCeilingMinor: null, grossEligibilityMaxMinor: null };

  it("accepts each basis with what it needs", () => {
    expect(checkRule({ ...base, code: "PF", basis: "PERCENT_OF_BASIC", employeePercent: 12, employerPercent: 12, wageCeilingMinor: 1_500_000 })).toEqual({ ok: true });
    expect(checkRule({ ...base, code: "PT", basis: "FIXED", fixedMinor: 20_000 })).toEqual({ ok: true });
    expect(checkRule({ ...base, code: "TDS", basis: "DECLARED" })).toEqual({ ok: true });
  });

  it("refuses mismatched fields and bad values", () => {
    expect(checkRule({ ...base, code: "pf", basis: "PERCENT_OF_BASIC", employeePercent: 12 }).ok).toBe(false);
    expect(checkRule({ ...base, code: "PF", basis: "PERCENT_OF_BASIC" }).ok).toBe(false);
    expect(checkRule({ ...base, code: "PF", basis: "PERCENT_OF_GROSS", employeePercent: 120 }).ok).toBe(false);
    expect(checkRule({ ...base, code: "PT", basis: "FIXED", fixedMinor: 20_000, employeePercent: 1 }).ok).toBe(false);
    expect(checkRule({ ...base, code: "TDS", basis: "DECLARED", fixedMinor: 100 }).ok).toBe(false);
  });
});
