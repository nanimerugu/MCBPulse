import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { ACCOUNT_CODES, fromMinor, toMinor } from "@/modules/finance/money";
import { ensureChartOfAccounts, postJournalEntry } from "@/modules/finance/ledger.service";
import { isOnPayroll, isValidPeriod, nextPayrollStatus, periodLabel, summarizePayroll } from "@/modules/hr/payroll";
import { computeSlip, payableDays, type PayLine } from "@/modules/hr/deductions";
import { declaredByStaff, toRule } from "@/modules/hr/deduction-rules.service";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * Payroll runs (blueprint 10.7). A run belongs to one branch and one month;
 * the unique index on (branchId, periodYear, periodMonth) is what stops the
 * same month being paid twice.
 *
 * Generating payslips is idempotent by design: it deletes and rewrites the
 * run's payslips from current pay, deduction rules and unpaid leave. That's
 * safe only because a run can be generated exclusively while DRAFT — once
 * it's PROCESSED the figures are frozen, and once PAID the ledger has a
 * matching journal entry that must keep agreeing with them.
 */

export interface PayrollScope {
  organizationId: string;
  branchId: string;
}

export async function listPayrollRuns(scope: PayrollScope) {
  return db.payrollRun.findMany({
    where: { organizationId: scope.organizationId, branchId: scope.branchId },
    include: { _count: { select: { payslips: true } } },
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
    take: 24,
  });
}

export async function getPayrollRun(runId: string, scope: PayrollScope) {
  return db.payrollRun.findFirst({
    where: { id: runId, organizationId: scope.organizationId, branchId: scope.branchId },
    include: {
      branch: true,
      payslips: {
        include: { staff: { include: { user: true, department: true, position: true } }, lines: { orderBy: { sequence: "asc" } } },
        orderBy: { staff: { employeeCode: "asc" } },
      },
    },
  });
}

export async function openPayrollRun(
  input: { month: number; year: number; deductionPercent: number; fixedDeductionMinor: number; deductionDescription?: string },
  scope: PayrollScope,
  actor: Actor,
) {
  if (!isValidPeriod(input.month, input.year)) throw new SisError("Pick a valid month and year");
  if (input.deductionPercent < 0 || input.deductionPercent > 100) throw new SisError("Deduction percentage must be between 0 and 100");
  if (input.fixedDeductionMinor < 0) throw new SisError("A fixed deduction can't be negative");

  const existing = await db.payrollRun.findFirst({
    where: { branchId: scope.branchId, periodYear: input.year, periodMonth: input.month },
  });
  if (existing) throw new SisError(`${periodLabel(input.month, input.year)} already has a payroll run`);

  const run = await db.payrollRun.create({
    data: {
      organizationId: scope.organizationId,
      branchId: scope.branchId,
      periodMonth: input.month,
      periodYear: input.year,
      deductionPercent: input.deductionPercent.toFixed(2),
      fixedDeduction: fromMinor(input.fixedDeductionMinor),
      deductionDescription: input.deductionDescription ?? null,
    },
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "payroll_run.opened",
    resourceType: "payroll_run",
    resourceId: run.id,
    after: { period: periodLabel(input.month, input.year), deductionPercent: input.deductionPercent, fixedDeductionMinor: input.fixedDeductionMinor },
  });
  return run;
}

export interface GenerateOutcome {
  generated: number;
  /** Staff left off the run, and why — shown rather than silently dropped. */
  skipped: { name: string; employeeCode: string; reason: string }[];
  /** How many payslips a rule didn't apply to (the reason is on the payslip). */
  ruleNotApplied: number;
  totals: { grossMinor: number; deductionsMinor: number; netMinor: number; count: number; employerMinor: number; lossOfPayDays: number };
}

interface SlipRow {
  staffId: string;
  grossMinor: number;
  deductionsMinor: number;
  netMinor: number;
  employerMinor: number;
  days: { daysInPeriod: number; payableDays: number; lossOfPayDays: number };
  lines: PayLine[];
}

export async function generatePayslips(runId: string, scope: PayrollScope, actor: Actor): Promise<GenerateOutcome> {
  const run = await db.payrollRun.findFirst({ where: { id: runId, organizationId: scope.organizationId, branchId: scope.branchId } });
  if (!run) throw new SisError("Payroll run not found");
  if (!nextPayrollStatus(run.status, "generate")) throw new SisError(`A ${run.status.toLowerCase()} run can't be regenerated`);

  const monthStart = new Date(Date.UTC(run.periodYear, run.periodMonth - 1, 1));
  const monthEnd = new Date(Date.UTC(run.periodYear, run.periodMonth, 0));

  // Everything is read BEFORE the transaction; the transaction only writes.
  const staff = await db.staff.findMany({
    where: { organizationId: scope.organizationId, branchId: scope.branchId, deletedAt: null },
    include: { user: true },
    orderBy: { employeeCode: "asc" },
  });
  const staffIds = staff.map((s) => s.id);
  const [ruleRows, declared, unpaidLeave] = await Promise.all([
    db.payrollDeductionRule.findMany({ where: { organizationId: scope.organizationId, active: true }, orderBy: { createdAt: "asc" } }),
    declaredByStaff(staffIds),
    db.leaveRequest.findMany({
      where: { staffId: { in: staffIds }, status: "APPROVED", unpaid: true, fromDate: { lte: monthEnd }, toDate: { gte: monthStart } },
      select: { staffId: true, fromDate: true, toDate: true },
    }),
  ]);
  const rules = ruleRows.map(toRule);

  const percent = Number(run.deductionPercent);
  const fixedMinor = toMinor(run.fixedDeduction);
  const skipped: GenerateOutcome["skipped"] = [];
  const rows: SlipRow[] = [];
  let ruleNotApplied = 0;

  for (const s of staff) {
    const label = { name: s.user.name, employeeCode: s.employeeCode };
    if (!isOnPayroll({ joinDate: s.joinDate, exitDate: s.exitDate, month: run.periodMonth, year: run.periodYear })) {
      skipped.push({ ...label, reason: s.exitDate ? "Left before this period" : "Joined after this period" });
      continue;
    }
    if (s.monthlyGrossPay === null) {
      skipped.push({ ...label, reason: "No monthly pay set" });
      continue;
    }

    const days = payableDays({
      joinDate: s.joinDate,
      exitDate: s.exitDate,
      month: run.periodMonth,
      year: run.periodYear,
      unpaidLeave: unpaidLeave.filter((l) => l.staffId === s.id).map((l) => ({ from: l.fromDate, to: l.toDate })),
    });
    if (days.payableDays === 0) {
      skipped.push({ ...label, reason: `No payable days this month (${days.lossOfPayDays} day${days.lossOfPayDays === 1 ? "" : "s"} unpaid leave)` });
      continue;
    }

    const slip = computeSlip({
      monthlyGrossMinor: toMinor(s.monthlyGrossPay),
      monthlyBasicMinor: s.monthlyBasicPay === null ? null : toMinor(s.monthlyBasicPay),
      days,
      rules,
      declaredMinor: declared.get(s.id) ?? new Map(),
      runPercent: percent,
      runFixedMinor: fixedMinor,
    });
    if (slip.skipped.length > 0) ruleNotApplied++;

    // A rule that didn't apply is recorded ON the payslip as a zero line with
    // the reason — the sums are untouched, and "why wasn't PF taken?" has an
    // answer on the page someone is holding.
    const notApplied: PayLine[] = slip.skipped.map((k) => ({
      kind: "DEDUCTION",
      code: k.code,
      label: k.code === "OTHER" ? "Other deduction" : (rules.find((r) => r.code === k.code)?.name ?? k.code),
      amountMinor: 0,
      detail: `not applied — ${k.reason}`,
    }));

    rows.push({
      staffId: s.id,
      grossMinor: slip.grossMinor,
      deductionsMinor: slip.deductionsMinor,
      netMinor: slip.netMinor,
      employerMinor: slip.employerMinor,
      days,
      lines: [...slip.lines, ...notApplied],
    });
  }

  await db.$transaction(
    async (tx) => {
      await tx.payslip.deleteMany({ where: { payrollRunId: runId } });
      for (const r of rows) {
        await tx.payslip.create({
          data: {
            payrollRunId: runId,
            staffId: r.staffId,
            grossPay: fromMinor(r.grossMinor),
            deductions: fromMinor(r.deductionsMinor),
            netPay: fromMinor(r.netMinor),
            employerContributions: fromMinor(r.employerMinor),
            daysInPeriod: r.days.daysInPeriod,
            payableDays: r.days.payableDays,
            lossOfPayDays: r.days.lossOfPayDays,
            lines: {
              create: r.lines.map((l, i) => ({ kind: l.kind, code: l.code, label: l.label, amount: fromMinor(l.amountMinor), detail: l.detail, sequence: i + 1 })),
            },
          },
        });
      }
    },
    { timeout: 30_000 },
  );

  const base = summarizePayroll(rows);
  const totals = {
    ...base,
    employerMinor: rows.reduce((s, r) => s + r.employerMinor, 0),
    lossOfPayDays: rows.reduce((s, r) => s + r.days.lossOfPayDays, 0),
  };
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "payroll_run.generated",
    resourceType: "payroll_run",
    resourceId: runId,
    after: { payslips: rows.length, skipped: skipped.length, netMinor: totals.netMinor, employerMinor: totals.employerMinor, lossOfPayDays: totals.lossOfPayDays, rules: rules.map((r) => r.code) },
  });

  return { generated: rows.length, skipped, ruleNotApplied, totals };
}

export async function processPayrollRun(runId: string, scope: PayrollScope, actor: Actor) {
  const run = await db.payrollRun.findFirst({
    where: { id: runId, organizationId: scope.organizationId, branchId: scope.branchId },
    include: { _count: { select: { payslips: true } } },
  });
  if (!run) throw new SisError("Payroll run not found");
  if (!nextPayrollStatus(run.status, "process")) throw new SisError(`A ${run.status.toLowerCase()} run can't be processed`);
  if (run._count.payslips === 0) throw new SisError("Generate payslips before processing the run");

  await db.payrollRun.update({ where: { id: runId }, data: { status: "PROCESSED", processedAt: new Date() } });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "payroll_run.processed",
    resourceType: "payroll_run",
    resourceId: runId,
    before: { status: run.status },
    after: { status: "PROCESSED", payslips: run._count.payslips },
  });
}

/**
 * Marking a run paid posts one balanced journal entry for the whole run:
 *
 *   debit  Salaries and wages            gross
 *   credit Bank                          net          (what actually left)
 *   credit Payroll deductions payable    deductions   (withheld, now owed on)
 *   debit  Employer contributions        employer share
 *   credit Payroll deductions payable    employer share
 *
 * The deductions are the school's own rules, so recording that the withheld
 * money is owed onward asserts nothing the school didn't decide. Remitting it
 * (to the fund, the insurer, the tax department) happens outside MCBPulse.
 *
 * The status flip and the posting share one transaction: a run can never be
 * marked paid without its journal entry, or vice versa.
 */
export async function payPayrollRun(runId: string, scope: PayrollScope, actor: Actor) {
  const run = await db.payrollRun.findFirst({
    where: { id: runId, organizationId: scope.organizationId, branchId: scope.branchId },
    include: { payslips: true },
  });
  if (!run) throw new SisError("Payroll run not found");
  if (!nextPayrollStatus(run.status, "pay")) throw new SisError(`A ${run.status.toLowerCase()} run can't be marked paid`);

  const grossMinor = run.payslips.reduce((sum, p) => sum + toMinor(p.grossPay), 0);
  const netMinor = run.payslips.reduce((sum, p) => sum + toMinor(p.netPay), 0);
  const deductionsMinor = run.payslips.reduce((sum, p) => sum + toMinor(p.deductions), 0);
  const employerMinor = run.payslips.reduce((sum, p) => sum + toMinor(p.employerContributions), 0);
  if (grossMinor <= 0) throw new SisError("This run has nothing to pay");
  if (grossMinor !== netMinor + deductionsMinor) throw new SisError("This run's payslips don't add up — regenerate it before paying");

  await ensureChartOfAccounts(scope.organizationId);
  const paidAt = new Date();

  const lines = [
    { accountCode: ACCOUNT_CODES.SALARY_EXPENSE, debitMinor: grossMinor },
    ...(netMinor > 0 ? [{ accountCode: ACCOUNT_CODES.BANK, creditMinor: netMinor }] : []),
    ...(deductionsMinor > 0 ? [{ accountCode: ACCOUNT_CODES.PAYROLL_DEDUCTIONS_PAYABLE, creditMinor: deductionsMinor }] : []),
    ...(employerMinor > 0
      ? [
          { accountCode: ACCOUNT_CODES.EMPLOYER_CONTRIBUTIONS_EXPENSE, debitMinor: employerMinor },
          { accountCode: ACCOUNT_CODES.PAYROLL_DEDUCTIONS_PAYABLE, creditMinor: employerMinor },
        ]
      : []),
  ];

  await db.$transaction(async (tx) => {
    await postJournalEntry(tx, {
      organizationId: scope.organizationId,
      entryDate: paidAt,
      description: `Payroll ${periodLabel(run.periodMonth, run.periodYear)} — ${run.payslips.length} payslip${run.payslips.length === 1 ? "" : "s"}`,
      createdByUserId: actor.userId,
      lines,
    });
    await tx.payrollRun.update({ where: { id: runId }, data: { status: "PAID", paidAt } });
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "payroll_run.paid",
    resourceType: "payroll_run",
    resourceId: runId,
    before: { status: run.status },
    after: { status: "PAID", grossMinor, netMinor, deductionsMinor, employerMinor, payslips: run.payslips.length },
  });
  return { netMinor, deductionsMinor, employerMinor };
}
