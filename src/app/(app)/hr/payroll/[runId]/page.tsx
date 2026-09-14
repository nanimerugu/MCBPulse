import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { withBranch } from "@/lib/branch-context";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, DescriptionList, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadHrAccess, param } from "@/modules/sis/access";
import { getPayrollRun } from "@/modules/hr/payroll.service";
import { allowedPayrollActions, PAYROLL_STATUS_LABELS, periodLabel, summarizePayroll } from "@/modules/hr/payroll";
import { formatMoney, toMinor } from "@/modules/finance/money";
import { formatDate } from "@/modules/sis/labels";
import { generatePayslipsAction, payPayrollRunAction, processPayrollRunAction } from "@/app/(app)/hr/actions";

const LINE_SIGN = { EARNING: "", LOSS_OF_PAY: "−", DEDUCTION: "−", EMPLOYER_CONTRIBUTION: "" } as const;

export default async function PayrollRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ runId }, sp] = await Promise.all([params, searchParams]);
  const result = await loadHrAccess(param(sp, "branch"), "hr.payroll", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Payroll run" />
        <AccessDenied result={result} permission="hr.payroll:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;

  const [run, held] = await Promise.all([
    getPayrollRun(runId, { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
  ]);
  if (!run) notFound();

  const slips = run.payslips.map((p) => ({
    grossMinor: toMinor(p.grossPay),
    deductionsMinor: toMinor(p.deductions),
    netMinor: toMinor(p.netPay),
  }));
  const totals = summarizePayroll(slips);
  const employerMinor = run.payslips.reduce((s, p) => s + toMinor(p.employerContributions), 0);
  const lossOfPayDays = run.payslips.reduce((s, p) => s + (p.lossOfPayDays ?? 0), 0);
  const available = allowedPayrollActions(run.status);
  const hidden = { branchId: ctx.branch.id };
  const percent = Number(run.deductionPercent);
  const fixedMinor = toMinor(run.fixedDeduction);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={periodLabel(run.periodMonth, run.periodYear)}
        description={`${run.branch.name} · ${PAYROLL_STATUS_LABELS[run.status]}`}
        actions={
          <>
            {held.has("hr.payroll:export") && run.payslips.length > 0 ? (
              <LinkButton href={withBranch(`/hr/payroll/${run.id}/export`, ctx)}>Export CSV</LinkButton>
            ) : null}
            <LinkButton href={withBranch("/hr/payroll/rules", ctx)}>Deduction rules</LinkButton>
            <LinkButton href={withBranch("/hr/payroll", ctx)}>All runs</LinkButton>
          </>
        }
      />

      <Card title="Run">
        <DescriptionList
          items={[
            { label: "Status", value: <Badge tone={run.status === "PAID" ? "green" : run.status === "PROCESSED" ? "blue" : "neutral"}>{PAYROLL_STATUS_LABELS[run.status]}</Badge> },
            { label: "Run's own deduction", value: percent > 0 || fixedMinor > 0 ? `${percent}%${fixedMinor > 0 ? ` + ${formatMoney(fixedMinor)} fixed` : ""}` : "None" },
            { label: "What it covers", value: run.deductionDescription ?? "Not stated" },
            { label: "Payslips", value: String(run.payslips.length) },
            { label: "Processed", value: run.processedAt ? formatDate(run.processedAt) : "—" },
            { label: "Paid", value: run.paidAt ? formatDate(run.paidAt) : "—" },
          ]}
        />
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Deductions come from the school&apos;s active deduction rules, applied when payslips are generated, plus any deduction set on the run
          itself. Each payslip below shows its working.
        </p>
      </Card>

      <Card title="Totals">
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Gross</p>
            <p className="mt-0.5 tabular-nums text-zinc-900 dark:text-zinc-50">{formatMoney(totals.grossMinor)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Deductions</p>
            <p className="mt-0.5 tabular-nums text-zinc-900 dark:text-zinc-50">−{formatMoney(totals.deductionsMinor)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Net payable</p>
            <p className="mt-0.5 font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{formatMoney(totals.netMinor)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Employer contributions</p>
            <p className="mt-0.5 tabular-nums text-zinc-900 dark:text-zinc-50">{formatMoney(employerMinor)}</p>
          </div>
        </div>
        {lossOfPayDays > 0 ? (
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            {lossOfPayDays} day{lossOfPayDays === 1 ? "" : "s"} of unpaid leave deducted across this run.
          </p>
        ) : null}
      </Card>

      {available.length > 0 ? (
        <Card title="Next step">
          <div className="flex flex-wrap items-start gap-3">
            {available.includes("generate") && held.has("hr.payroll:create") ? (
              <ActionForm
                action={generatePayslipsAction.bind(null, run.id)}
                hidden={hidden}
                submitLabel={run.payslips.length > 0 ? "Regenerate payslips" : "Generate payslips"}
                pendingLabel="Generating…"
                inline
              />
            ) : null}
            {/* Processing an empty run is refused by the service; don't offer the button at all. */}
            {available.includes("process") && held.has("hr.payroll:approve") && run.payslips.length > 0 ? (
              <ActionForm action={processPayrollRunAction.bind(null, run.id)} hidden={hidden} submitLabel="Mark processed" variant="primary" inline />
            ) : null}
            {available.includes("pay") && held.has("hr.payroll:approve") ? (
              <ActionForm action={payPayrollRunAction.bind(null, run.id)} hidden={hidden} submitLabel="Mark paid" variant="primary" inline />
            ) : null}
          </div>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            {run.status === "DRAFT"
              ? "Payslips are rebuilt from current pay, deduction rules and approved unpaid leave each time you generate. Processing freezes them."
              : run.status === "PROCESSED"
                ? "Marking this paid debits salaries for gross pay, credits the bank for net pay, and credits payroll deductions payable for what was withheld (and the employer's contributions) — in one journal entry."
                : null}
          </p>
        </Card>
      ) : null}

      <Card title="Payslips">
        {run.payslips.length === 0 ? (
          <EmptyState>No payslips generated yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <tr>
                  <th className="py-2 pr-4 font-medium">Code</th>
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 text-right font-medium">Days paid</th>
                  <th className="py-2 pr-4 text-right font-medium">Gross</th>
                  <th className="py-2 pr-4 text-right font-medium">Deductions</th>
                  <th className="py-2 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {run.payslips.map((p) => (
                  <Fragment key={p.id}>
                    <tr>
                      <td className="py-2 pr-4 font-mono text-xs">{p.staff.employeeCode}</td>
                      <td className="py-2 pr-4">
                        <Link href={withBranch(`/hr/people/${p.staffId}`, ctx)} className="font-medium hover:underline">
                          {p.staff.user.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                        {p.payableDays !== null && p.daysInPeriod !== null ? `${p.payableDays}/${p.daysInPeriod}` : "—"}
                        {p.lossOfPayDays ? <span className="block text-xs text-amber-700 dark:text-amber-400">{p.lossOfPayDays} unpaid</span> : null}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(toMinor(p.grossPay))}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">−{formatMoney(toMinor(p.deductions))}</td>
                      <td className="py-2 text-right font-medium tabular-nums">{formatMoney(toMinor(p.netPay))}</td>
                    </tr>
                    {p.lines.length > 0 ? (
                      <tr>
                        <td colSpan={6} className="pb-3 pt-0">
                          <details>
                            <summary className="cursor-pointer text-xs text-zinc-500 dark:text-zinc-400">Working</summary>
                            <table className="mt-1 w-full text-xs">
                              <tbody>
                                {p.lines.map((l) => (
                                  <tr key={l.id} className={toMinor(l.amount) === 0 ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-700 dark:text-zinc-300"}>
                                    <td className="py-0.5 pr-3 font-mono">{l.code}</td>
                                    <td className="py-0.5 pr-3">{l.label}</td>
                                    <td className="py-0.5 pr-3">{l.detail}</td>
                                    <td className="py-0.5 text-right tabular-nums">
                                      {toMinor(l.amount) > 0 ? LINE_SIGN[l.kind] : ""}
                                      {formatMoney(toMinor(l.amount))}
                                      {l.kind === "EMPLOYER_CONTRIBUTION" ? " (employer)" : ""}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </details>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              Days paid counts calendar days: joining or leaving mid-month, and approved leave marked <strong>unpaid</strong>, reduce gross pay in
              proportion. Paid leave changes nothing. A rule that didn&apos;t apply to someone is listed in their working with the reason.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
