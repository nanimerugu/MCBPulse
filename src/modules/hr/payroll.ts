import type { PayrollRunStatus } from "@/generated/prisma/enums";

/**
 * Payroll arithmetic and lifecycle (blueprint 10.7: "monthly payroll
 * calculates earnings, deductions, reimbursements and statutory fields").
 * Money is in integer minor units throughout, same as Finance — see
 * src/modules/finance/money.ts for why.
 *
 * DELIBERATELY NOT A STATUTORY ENGINE. Real Indian payroll needs PF slabs,
 * ESI eligibility thresholds, professional tax that varies by state, and
 * TDS against each employee's declarations — and blueprint section 18 says
 * to "obtain legal review before production". Encoding guessed rates here
 * would produce numbers that look official and are wrong, which is worse
 * than none. So a run carries an explicit deduction percentage and an
 * optional fixed amount, both entered by whoever runs payroll and recorded
 * on every payslip, and the real engine is named as a gap in the README.
 */

export interface PayslipComputation {
  grossMinor: number;
  deductionsMinor: number;
  netMinor: number;
}

/** Deductions never exceed gross: nobody's net pay goes negative. */
export function computePayslip(args: { grossMinor: number; deductionPercent: number; fixedDeductionMinor: number }): PayslipComputation {
  const pct = Math.min(Math.max(args.deductionPercent, 0), 100);
  const percentPart = Math.round((args.grossMinor * pct) / 100);
  const requested = percentPart + Math.max(0, args.fixedDeductionMinor);
  const deductionsMinor = Math.min(requested, args.grossMinor);
  return { grossMinor: args.grossMinor, deductionsMinor, netMinor: args.grossMinor - deductionsMinor };
}

export interface PayrollTotals extends PayslipComputation {
  count: number;
}

export function summarizePayroll(slips: readonly PayslipComputation[]): PayrollTotals {
  return slips.reduce<PayrollTotals>(
    (acc, s) => ({
      grossMinor: acc.grossMinor + s.grossMinor,
      deductionsMinor: acc.deductionsMinor + s.deductionsMinor,
      netMinor: acc.netMinor + s.netMinor,
      count: acc.count + 1,
    }),
    { grossMinor: 0, deductionsMinor: 0, netMinor: 0, count: 0 },
  );
}

/**
 * DRAFT ─generate/regenerate──▶ DRAFT
 *   │                             │
 *   └──process──▶ PROCESSED ──pay──▶ PAID (terminal, posts to the ledger)
 *
 * A run can be regenerated freely while DRAFT and is frozen afterwards —
 * payslips someone has already been shown must not change underneath them.
 */
export type PayrollAction = "generate" | "process" | "pay";

const TRANSITIONS: Record<PayrollRunStatus, Partial<Record<PayrollAction, PayrollRunStatus>>> = {
  DRAFT: { generate: "DRAFT", process: "PROCESSED" },
  PROCESSED: { pay: "PAID" },
  PAID: {},
};

export function nextPayrollStatus(from: PayrollRunStatus, action: PayrollAction): PayrollRunStatus | null {
  return TRANSITIONS[from][action] ?? null;
}

export function allowedPayrollActions(from: PayrollRunStatus): PayrollAction[] {
  return (Object.keys(TRANSITIONS[from]) as PayrollAction[]).filter((a) => TRANSITIONS[from][a] !== undefined);
}

export const PAYROLL_STATUS_LABELS: Record<PayrollRunStatus, string> = {
  DRAFT: "Draft",
  PROCESSED: "Processed",
  PAID: "Paid",
};

export const PAYROLL_ACTION_LABELS: Record<PayrollAction, string> = {
  generate: "Generate payslips",
  process: "Mark processed",
  pay: "Mark paid (posts to ledger)",
};

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function periodLabel(month: number, year: number): string {
  return `${MONTH_NAMES[month - 1] ?? "?"} ${year}`;
}

export function isValidPeriod(month: number, year: number): boolean {
  return Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(year) && year >= 2000 && year <= 2100;
}

/** Staff who joined after the period ended, or left before it began, aren't on this run. */
export function isOnPayroll(args: { joinDate: Date; exitDate: Date | null; month: number; year: number }): boolean {
  const periodStart = Date.UTC(args.year, args.month - 1, 1);
  const periodEnd = Date.UTC(args.year, args.month, 0, 23, 59, 59);
  if (args.joinDate.getTime() > periodEnd) return false;
  if (args.exitDate && args.exitDate.getTime() < periodStart) return false;
  return true;
}
