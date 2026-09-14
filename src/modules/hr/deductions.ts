/**
 * Payroll deductions and proration — the pure half.
 *
 * STILL NOT A STATUTORY ENGINE, and deliberately so. There are no PF slabs,
 * ESI thresholds, professional-tax tables or income-tax computations in this
 * file, and none will be added: those numbers change by law, by state and by
 * year, and a wrong one here would look official on every payslip. What this
 * file does is apply rules the SCHOOL has written down — "12% of basic,
 * capped at a wage ceiling", "0.75% of gross if gross is under a threshold",
 * "₹200 a month", "whatever the accountant declared" — consistently, and
 * show its working line by line.
 *
 * Money is integer minor units throughout.
 */

export type DeductionBasis = "PERCENT_OF_BASIC" | "PERCENT_OF_GROSS" | "FIXED" | "DECLARED";

export interface DeductionRule {
  id: string;
  code: string;
  name: string;
  basis: DeductionBasis;
  employeePercent: number | null;
  employerPercent: number | null;
  fixedMinor: number | null;
  wageCeilingMinor: number | null;
  grossEligibilityMaxMinor: number | null;
}

export type LineKind = "EARNING" | "LOSS_OF_PAY" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION";

export interface PayLine {
  kind: LineKind;
  code: string;
  label: string;
  amountMinor: number;
  detail: string | null;
}

const DAY_MS = 86_400_000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export interface DateSpan {
  from: Date;
  to: Date;
}

/**
 * The days of a month someone is paid for.
 *
 *   employed days  = the part of the month between joining and leaving
 *   loss-of-pay    = UNPAID leave days inside that employed part, with
 *                    overlapping leave counted once
 *   payable days   = employed − loss-of-pay
 *
 * Calendar days throughout, which is one common convention and the one this
 * applies; a school on a "30-day month" or working-days basis would see
 * slightly different proration, and the payslip states the days used.
 */
export function payableDays(args: { joinDate: Date; exitDate: Date | null; month: number; year: number; unpaidLeave: readonly DateSpan[] }) {
  const start = Date.UTC(args.year, args.month - 1, 1);
  const end = Date.UTC(args.year, args.month, 0);
  const daysInPeriod = Math.round((end - start) / DAY_MS) + 1;

  const empFrom = Math.max(start, utcDay(args.joinDate));
  const empTo = Math.min(end, args.exitDate ? utcDay(args.exitDate) : end);
  if (empTo < empFrom) return { daysInPeriod, employedDays: 0, lossOfPayDays: 0, payableDays: 0 };
  const employedDays = Math.round((empTo - empFrom) / DAY_MS) + 1;

  // Mark each unpaid day once, so two overlapping requests don't dock twice.
  const unpaid = new Set<number>();
  for (const span of args.unpaidLeave) {
    const a = Math.max(empFrom, utcDay(span.from));
    const b = Math.min(empTo, utcDay(span.to));
    for (let t = a; t <= b; t += DAY_MS) unpaid.add(t);
  }
  const lossOfPayDays = unpaid.size;
  return { daysInPeriod, employedDays, lossOfPayDays, payableDays: employedDays - lossOfPayDays };
}

export function prorate(monthlyMinor: number, days: number, daysInPeriod: number): number {
  if (monthlyMinor <= 0 || days <= 0 || daysInPeriod <= 0) return 0;
  if (days >= daysInPeriod) return monthlyMinor;
  return Math.round((monthlyMinor * days) / daysInPeriod);
}

const pct = (base: number, percent: number) => Math.round((base * percent) / 100);
const rupees = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export interface SlipInput {
  /** The full monthly figures, before proration. Eligibility is judged on these. */
  monthlyGrossMinor: number;
  monthlyBasicMinor: number | null;
  days: { daysInPeriod: number; payableDays: number; lossOfPayDays: number };
  rules: readonly DeductionRule[];
  /** DECLARED amounts by rule id, per month. */
  declaredMinor: ReadonlyMap<string, number>;
  /** The run's own flat deduction, kept from before rules existed. */
  runPercent: number;
  runFixedMinor: number;
}

export interface SlipResult {
  grossMinor: number;
  deductionsMinor: number;
  netMinor: number;
  employerMinor: number;
  lines: PayLine[];
  /** Rules that didn't apply to this person, and why — shown, never silent. */
  skipped: { code: string; reason: string }[];
}

/**
 * One payslip.
 *
 * Gross is prorated for days not paid. Percentage rules apply to the
 * PRORATED base (a person paid for half a month contributes on half a
 * month), capped at the rule's wage ceiling. Eligibility thresholds are
 * judged on the full monthly gross, so a person doesn't move in and out of
 * a scheme because of a week's unpaid leave.
 *
 * Deductions never take net pay below zero: once gross is exhausted, later
 * rules are reduced, and the line says so. Employer contributions are
 * listed separately and never reduce net pay.
 */
export function computeSlip(input: SlipInput): SlipResult {
  const { daysInPeriod, payableDays: paid, lossOfPayDays } = input.days;
  const grossMinor = prorate(input.monthlyGrossMinor, paid, daysInPeriod);
  const basicMinor = input.monthlyBasicMinor === null ? null : prorate(input.monthlyBasicMinor, paid, daysInPeriod);

  const lines: PayLine[] = [
    {
      kind: "EARNING",
      code: "GROSS",
      label: "Monthly gross",
      amountMinor: input.monthlyGrossMinor,
      detail: null,
    },
  ];
  const unpaidDays = daysInPeriod - paid;
  if (unpaidDays > 0) {
    lines.push({
      kind: "LOSS_OF_PAY",
      code: "LOP",
      label: lossOfPayDays > 0 ? "Loss of pay" : "Part month",
      amountMinor: input.monthlyGrossMinor - grossMinor,
      detail: `${paid} of ${daysInPeriod} days paid${lossOfPayDays > 0 ? ` (${lossOfPayDays} day${lossOfPayDays === 1 ? "" : "s"} unpaid leave)` : ""}`,
    });
  }

  const skipped: SlipResult["skipped"] = [];
  let remaining = grossMinor;
  let deductionsMinor = 0;
  let employerMinor = 0;

  const deduct = (code: string, label: string, wanted: number, detail: string) => {
    const amount = Math.min(Math.max(0, wanted), remaining);
    if (amount <= 0 && wanted > 0) {
      skipped.push({ code, reason: "nothing left of gross pay to deduct from" });
      return;
    }
    if (amount <= 0) return;
    remaining -= amount;
    deductionsMinor += amount;
    lines.push({ kind: "DEDUCTION", code, label, amountMinor: amount, detail: amount < wanted ? `${detail} — reduced to what gross pay allowed` : detail });
  };

  for (const rule of input.rules) {
    if (rule.grossEligibilityMaxMinor !== null && input.monthlyGrossMinor > rule.grossEligibilityMaxMinor) {
      skipped.push({ code: rule.code, reason: `monthly gross above ${rupees(rule.grossEligibilityMaxMinor)}` });
      continue;
    }

    if (rule.basis === "FIXED") {
      if (!rule.fixedMinor) continue;
      deduct(rule.code, rule.name, rule.fixedMinor, "fixed per month");
      continue;
    }

    if (rule.basis === "DECLARED") {
      const declared = input.declaredMinor.get(rule.id);
      if (declared === undefined) {
        skipped.push({ code: rule.code, reason: "no amount declared for this person" });
        continue;
      }
      deduct(rule.code, rule.name, declared, "declared for this person");
      continue;
    }

    const rawBase = rule.basis === "PERCENT_OF_BASIC" ? basicMinor : grossMinor;
    if (rawBase === null) {
      skipped.push({ code: rule.code, reason: "basic pay isn't set for this person" });
      continue;
    }
    const capped = rule.wageCeilingMinor !== null && rawBase > rule.wageCeilingMinor;
    const base = capped ? rule.wageCeilingMinor! : rawBase;
    const baseLabel = `${rule.basis === "PERCENT_OF_BASIC" ? "basic" : "gross"} ${rupees(base)}${capped ? " (capped)" : ""}`;

    if (rule.employeePercent) deduct(rule.code, rule.name, pct(base, rule.employeePercent), `${rule.employeePercent}% of ${baseLabel}`);
    if (rule.employerPercent) {
      const amount = pct(base, rule.employerPercent);
      if (amount > 0) {
        employerMinor += amount;
        lines.push({ kind: "EMPLOYER_CONTRIBUTION", code: rule.code, label: `${rule.name} (employer)`, amountMinor: amount, detail: `${rule.employerPercent}% of ${baseLabel}` });
      }
    }
  }

  // The run's flat deduction, as before rules existed: kept so old runs and
  // one-off recoveries still work, and applied last.
  const flat = pct(grossMinor, Math.min(Math.max(input.runPercent, 0), 100)) + Math.max(0, input.runFixedMinor);
  if (flat > 0) deduct("OTHER", "Other deduction", flat, "set on this payroll run");

  return { grossMinor, deductionsMinor, netMinor: grossMinor - deductionsMinor, employerMinor, lines, skipped };
}

export type RuleCheck = { ok: true } | { ok: false; message: string };

/** What a rule needs, by basis. The rates themselves are never second-guessed. */
export function checkRule(r: Omit<DeductionRule, "id">): RuleCheck {
  if (!/^[A-Z0-9_]{1,12}$/.test(r.code)) return { ok: false, message: "Code: up to 12 capital letters, digits or underscores, e.g. PF" };
  if (r.name.trim().length === 0) return { ok: false, message: "Name the deduction" };
  const inRange = (p: number | null) => p === null || (p >= 0 && p <= 100);
  if (!inRange(r.employeePercent) || !inRange(r.employerPercent)) return { ok: false, message: "Percentages are between 0 and 100" };
  const nonNeg = (m: number | null) => m === null || m >= 0;
  if (!nonNeg(r.fixedMinor) || !nonNeg(r.wageCeilingMinor) || !nonNeg(r.grossEligibilityMaxMinor)) return { ok: false, message: "Amounts can't be negative" };

  switch (r.basis) {
    case "PERCENT_OF_BASIC":
    case "PERCENT_OF_GROSS":
      if (!r.employeePercent && !r.employerPercent) return { ok: false, message: "A percentage rule needs an employee or employer percentage" };
      if (r.fixedMinor !== null) return { ok: false, message: "A percentage rule doesn't take a fixed amount" };
      return { ok: true };
    case "FIXED":
      if (!r.fixedMinor) return { ok: false, message: "A fixed rule needs its monthly amount" };
      if (r.employeePercent || r.employerPercent || r.wageCeilingMinor !== null) return { ok: false, message: "A fixed rule doesn't take percentages or a ceiling" };
      return { ok: true };
    case "DECLARED":
      if (r.employeePercent || r.employerPercent || r.fixedMinor !== null || r.wageCeilingMinor !== null) {
        return { ok: false, message: "A declared rule takes no rate — each person's amount is entered on their record" };
      }
      return { ok: true };
  }
}

export const BASIS_LABELS: Record<DeductionBasis, string> = {
  PERCENT_OF_BASIC: "Percentage of basic pay",
  PERCENT_OF_GROSS: "Percentage of gross pay",
  FIXED: "Fixed amount per month",
  DECLARED: "Declared per person (e.g. tax withheld)",
};
