import Link from "next/link";
import { notFound } from "next/navigation";
import { withBranch } from "@/lib/branch-context";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, DescriptionList, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadHrAccess, param } from "@/modules/sis/access";
import { getPayrollRun } from "@/modules/hr/payroll.service";
import { approvedLeaveInPeriod } from "@/modules/hr/staff-leave.service";
import { allowedPayrollActions, PAYROLL_STATUS_LABELS, periodLabel, summarizePayroll } from "@/modules/hr/payroll";
import { daysWithinPeriod } from "@/modules/hr/leave";
import { formatMoney, toMinor } from "@/modules/finance/money";
import { formatDate } from "@/modules/sis/labels";
import { generatePayslipsAction, payPayrollRunAction, processPayrollRunAction } from "@/app/(app)/hr/actions";

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

  const leave = await approvedLeaveInPeriod(ctx.organizationId, ctx.branch.id, run.periodMonth, run.periodYear);
  const leaveDaysByStaff = new Map<string, number>();
  for (const l of leave) {
    if (!l.staffId) continue;
    leaveDaysByStaff.set(l.staffId, (leaveDaysByStaff.get(l.staffId) ?? 0) + daysWithinPeriod(l, run.periodMonth, run.periodYear));
  }

  const slips = run.payslips.map((p) => ({
    grossMinor: toMinor(p.grossPay),
    deductionsMinor: toMinor(p.deductions),
    netMinor: toMinor(p.netPay),
  }));
  const totals = summarizePayroll(slips);
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
            <LinkButton href={withBranch("/hr/payroll", ctx)}>All runs</LinkButton>
          </>
        }
      />

      <Card title="Run">
        <DescriptionList
          items={[
            { label: "Status", value: <Badge tone={run.status === "PAID" ? "green" : run.status === "PROCESSED" ? "blue" : "neutral"}>{PAYROLL_STATUS_LABELS[run.status]}</Badge> },
            { label: "Deduction rule", value: `${percent}%${fixedMinor > 0 ? ` + ${formatMoney(fixedMinor)} fixed` : ""}` },
            { label: "What it covers", value: run.deductionDescription ?? "Not stated" },
            { label: "Payslips", value: String(run.payslips.length) },
            { label: "Processed", value: run.processedAt ? formatDate(run.processedAt) : "—" },
            { label: "Paid", value: run.paidAt ? formatDate(run.paidAt) : "—" },
          ]}
        />
      </Card>

      <Card title="Totals">
        <div className="grid grid-cols-3 gap-4 text-sm">
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
        </div>
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
              ? "Payslips are rebuilt from current staff pay each time you generate. Processing freezes them."
              : run.status === "PROCESSED"
                ? "Marking this paid debits salary expense and credits the bank for the net total, in one journal entry."
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
                  <th className="py-2 pr-4 font-medium">Department</th>
                  <th className="py-2 pr-4 text-right font-medium">Gross</th>
                  <th className="py-2 pr-4 text-right font-medium">Deductions</th>
                  <th className="py-2 pr-4 text-right font-medium">Net</th>
                  <th className="py-2 text-right font-medium">Leave</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {run.payslips.map((p) => {
                  const days = leaveDaysByStaff.get(p.staffId) ?? 0;
                  return (
                    <tr key={p.id}>
                      <td className="py-2 pr-4 font-mono text-xs">{p.staff.employeeCode}</td>
                      <td className="py-2 pr-4">
                        <Link href={withBranch(`/hr/people/${p.staffId}`, ctx)} className="font-medium hover:underline">
                          {p.staff.user.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-zinc-500 dark:text-zinc-400">{p.staff.department?.name ?? "—"}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(toMinor(p.grossPay))}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">−{formatMoney(toMinor(p.deductions))}</td>
                      <td className="py-2 pr-4 text-right font-medium tabular-nums">{formatMoney(toMinor(p.netPay))}</td>
                      <td className="py-2 text-right text-zinc-500 dark:text-zinc-400">{days > 0 ? `${days}d` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              The leave column is context only — approved leave days falling inside this month. Pay is <strong>not</strong> prorated for them;
              unpaid-leave rules are a policy decision this build does not make.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
