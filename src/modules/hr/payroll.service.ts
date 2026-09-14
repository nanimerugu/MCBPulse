import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { ACCOUNT_CODES, fromMinor, toMinor } from "@/modules/finance/money";
import { ensureChartOfAccounts, postJournalEntry } from "@/modules/finance/ledger.service";
import { computePayslip, isOnPayroll, isValidPeriod, nextPayrollStatus, periodLabel, summarizePayroll } from "@/modules/hr/payroll";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * Payroll runs (blueprint 10.7). A run belongs to one branch and one month;
 * the unique index on (branchId, periodYear, periodMonth) is what stops the
 * same month being paid twice.
 *
 * Generating payslips is idempotent by design: it deletes and rewrites the
 * run's payslips from current staff pay. That's safe only because a run can
 * be generated exclusively while DRAFT — once it's PROCESSED the figures are
 * frozen, and once PAID the ledger has a matching journal entry that must
 * keep agreeing with them.
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
        include: { staff: { include: { user: true, department: true, position: true } } },
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
  totals: { grossMinor: number; deductionsMinor: number; netMinor: number; count: number };
}

export async function generatePayslips(runId: string, scope: PayrollScope, actor: Actor): Promise<GenerateOutcome> {
  const run = await db.payrollRun.findFirst({ where: { id: runId, organizationId: scope.organizationId, branchId: scope.branchId } });
  if (!run) throw new SisError("Payroll run not found");
  if (!nextPayrollStatus(run.status, "generate")) throw new SisError(`A ${run.status.toLowerCase()} run can't be regenerated`);

  const staff = await db.staff.findMany({
    where: { organizationId: scope.organizationId, branchId: scope.branchId, deletedAt: null },
    include: { user: true },
    orderBy: { employeeCode: "asc" },
  });

  const percent = Number(run.deductionPercent);
  const fixedMinor = toMinor(run.fixedDeduction);
  const skipped: GenerateOutcome["skipped"] = [];
  const rows: { staffId: string; grossMinor: number; deductionsMinor: number; netMinor: number }[] = [];

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
    const computed = computePayslip({ grossMinor: toMinor(s.monthlyGrossPay), deductionPercent: percent, fixedDeductionMinor: fixedMinor });
    rows.push({ staffId: s.id, ...computed });
  }

  await db.$transaction(async (tx) => {
    await tx.payslip.deleteMany({ where: { payrollRunId: runId } });
    if (rows.length > 0) {
      await tx.payslip.createMany({
        data: rows.map((r) => ({
          payrollRunId: runId,
          staffId: r.staffId,
          grossPay: fromMinor(r.grossMinor),
          deductions: fromMinor(r.deductionsMinor),
          netPay: fromMinor(r.netMinor),
        })),
      });
    }
  });

  const totals = summarizePayroll(rows);
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "payroll_run.generated",
    resourceType: "payroll_run",
    resourceId: runId,
    after: { payslips: rows.length, skipped: skipped.length, netMinor: totals.netMinor },
  });

  return { generated: rows.length, skipped, totals };
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
 * debit salary expense, credit bank, for the total NET pay. Deductions are
 * not credited to a statutory liability account here — that would assert a
 * PF/ESI/TDS treatment this system is explicitly not qualified to make (see
 * payroll.ts), so the entry records only money that actually left the bank.
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

  const netMinor = run.payslips.reduce((sum, p) => sum + toMinor(p.netPay), 0);
  if (netMinor <= 0) throw new SisError("This run has nothing to pay");

  await ensureChartOfAccounts(scope.organizationId);
  const paidAt = new Date();

  await db.$transaction(async (tx) => {
    await postJournalEntry(tx, {
      organizationId: scope.organizationId,
      entryDate: paidAt,
      description: `Payroll ${periodLabel(run.periodMonth, run.periodYear)} — ${run.payslips.length} payslip${run.payslips.length === 1 ? "" : "s"}`,
      createdByUserId: actor.userId,
      lines: [
        { accountCode: ACCOUNT_CODES.SALARY_EXPENSE, debitMinor: netMinor },
        { accountCode: ACCOUNT_CODES.BANK, creditMinor: netMinor },
      ],
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
    after: { status: "PAID", netMinor, payslips: run.payslips.length },
  });
  return { netMinor };
}
