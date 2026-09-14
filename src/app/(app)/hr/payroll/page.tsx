import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadHrAccess, param } from "@/modules/sis/access";
import { listPayrollRuns } from "@/modules/hr/payroll.service";
import { MONTH_NAMES, PAYROLL_STATUS_LABELS, periodLabel } from "@/modules/hr/payroll";
import { formatDate } from "@/modules/sis/labels";
import { openPayrollRunAction } from "@/app/(app)/hr/actions";

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadHrAccess(param(sp, "branch"), "hr.payroll", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Payroll" />
        <AccessDenied result={result} permission="hr.payroll:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const [runs, canOpen] = await Promise.all([
    listPayrollRuns({ organizationId: ctx.organizationId, branchId: ctx.branch.id }),
    authorize(viewer.userId, "hr.payroll", "create", { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
  ]);

  const now = new Date();
  const hidden = { branchId: ctx.branch.id };

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Payroll"
        description={`${ctx.branch.name} · one run per month, per branch`}
        actions={
          <>
            <LinkButton href={withBranch("/hr/payroll/rules", ctx)}>Deduction rules</LinkButton>
            <LinkButton href={withBranch("/hr", ctx)}>Back to HR</LinkButton>
          </>
        }
      />

      {canOpen ? (
        <Card title="Open a run">
          <ActionForm action={openPayrollRunAction} hidden={hidden} submitLabel="Open run">
            <div className="flex flex-wrap gap-3">
              <Field label="Month" htmlFor="pr-month">
                <Select id="pr-month" name="month" defaultValue={String(now.getUTCMonth() + 1)}>
                  {MONTH_NAMES.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Year" htmlFor="pr-year">
                <Input id="pr-year" name="year" type="number" min={2000} max={2100} defaultValue={now.getUTCFullYear()} />
              </Field>
              <Field label="Deduction %" htmlFor="pr-pct" hint="Applied to every payslip">
                <Input id="pr-pct" name="deductionPercent" inputMode="decimal" defaultValue="0" />
              </Field>
              <Field label="Fixed deduction" htmlFor="pr-fixed" hint="Optional, per payslip">
                <Input id="pr-fixed" name="fixedDeduction" inputMode="decimal" placeholder="0.00" />
              </Field>
            </div>
            <Field label="What the deduction is" htmlFor="pr-desc" hint="Recorded on the run so a payslip can always be explained.">
              <Input id="pr-desc" name="deductionDescription" maxLength={200} placeholder="Provident fund + professional tax" />
            </Field>
          </ActionForm>
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
            These figures are yours to supply. MCBPulse does not compute PF, ESI, professional tax or TDS, and does not produce a compliant
            statutory filing.
          </p>
        </Card>
      ) : null}

      <Card title="Runs">
        {runs.length === 0 ? (
          <EmptyState>No payroll run yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <Link href={withBranch(`/hr/payroll/${r.id}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                  {periodLabel(r.periodMonth, r.periodYear)}
                </Link>
                <span className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                  {r._count.payslips} payslip{r._count.payslips === 1 ? "" : "s"}
                  {r.paidAt ? ` · paid ${formatDate(r.paidAt)}` : r.processedAt ? ` · processed ${formatDate(r.processedAt)}` : ""}
                  <Badge tone={r.status === "PAID" ? "green" : r.status === "PROCESSED" ? "blue" : "neutral"}>
                    {PAYROLL_STATUS_LABELS[r.status].toLowerCase()}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
