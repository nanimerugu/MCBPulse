import { withBranch } from "@/lib/branch-context";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadHrAccess, param } from "@/modules/sis/access";
import { listDeductionRules } from "@/modules/hr/deduction-rules.service";
import { BASIS_LABELS } from "@/modules/hr/deductions";
import { formatMoney, toMinor } from "@/modules/finance/money";
import { createDeductionRuleAction, setDeductionRuleActiveAction } from "@/app/(app)/hr/actions";

export default async function DeductionRulesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadHrAccess(param(sp, "branch"), "hr.payroll", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Deduction rules" />
        <AccessDenied result={result} permission="hr.payroll:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const [rules, held] = await Promise.all([listDeductionRules(ctx.organizationId), heldPermissionKeys(viewer.userId, ctx.organizationId)]);
  const canConfigure = held.has("hr.payroll:configure");
  const hidden = { branchId: ctx.branch.id };
  const money = (d: { toString(): string } | null) => (d === null ? "—" : formatMoney(toMinor(d)));

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Deduction rules"
        description="What is withheld from pay, and how — as your school defines it"
        actions={<LinkButton href={withBranch("/hr/payroll", ctx)}>← Payroll</LinkButton>}
      />

      <div role="note" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        <p className="font-medium">MCBPulse has no statutory tables.</p>
        <p className="mt-1">
          Every rate, ceiling and threshold below is what your school enters. Nothing is filled in for provident fund, state insurance,
          professional tax or income tax, because those change by law, by state and by year — confirm each figure with your accountant. Tax
          withheld is a <em>declared</em> amount per person, computed by your accountant, not by this system. MCBPulse prepares no statutory
          return.
        </p>
      </div>

      <Card title={`Rules (${rules.length})`}>
        {rules.length === 0 ? (
          <EmptyState>No rules yet. Until you add one, payslips have no deductions beyond anything set on the payroll run itself.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <tr>
                  <th className="py-2 pr-3 font-medium">Code</th>
                  <th className="py-2 pr-3 font-medium">Rule</th>
                  <th className="py-2 pr-3 font-medium">Basis</th>
                  <th className="py-2 pr-3 text-right font-medium">Employee</th>
                  <th className="py-2 pr-3 text-right font-medium">Employer</th>
                  <th className="py-2 pr-3 text-right font-medium">Fixed</th>
                  <th className="py-2 pr-3 text-right font-medium">Ceiling</th>
                  <th className="py-2 pr-3 text-right font-medium">Only if gross ≤</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {rules.map((r) => (
                  <tr key={r.id} className={r.active ? undefined : "opacity-60"}>
                    <td className="py-2 pr-3 font-mono text-xs">{r.code}</td>
                    <td className="py-2 pr-3">
                      {r.name} {r.active ? null : <Badge tone="neutral">off</Badge>}
                    </td>
                    <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-300">{BASIS_LABELS[r.basis]}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.employeePercent === null ? "—" : `${Number(r.employeePercent)}%`}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.employerPercent === null ? "—" : `${Number(r.employerPercent)}%`}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(r.fixedAmount)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(r.wageCeiling)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(r.grossEligibilityMax)}</td>
                    <td className="py-2 text-right">
                      {canConfigure ? (
                        <ActionForm
                          action={setDeductionRuleActiveAction.bind(null, r.id, !r.active)}
                          hidden={hidden}
                          submitLabel={r.active ? "Switch off" : "Switch on"}
                          variant={r.active ? "danger" : "secondary"}
                          inline
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Rules apply in the order they were created. A rule is switched off rather than edited, so a payslip that already names it still
          explains itself; to change a rate, switch the old rule off and add a new one. Payslips generated before a change keep the figures they
          were generated with.
        </p>
      </Card>

      {canConfigure ? (
        <Card title="Add a rule">
          <ActionForm action={createDeductionRuleAction} hidden={hidden} submitLabel="Add rule">
            <div className="flex flex-wrap gap-3">
              <Field label="Code" htmlFor="dr-code" hint="e.g. PF, ESI, PT, TDS">
                <Input id="dr-code" name="code" required maxLength={12} className="!w-28 uppercase" />
              </Field>
              <Field label="Name" htmlFor="dr-name">
                <Input id="dr-name" name="name" required maxLength={80} placeholder="Provident fund" className="!w-56" />
              </Field>
              <Field label="Basis" htmlFor="dr-basis">
                <Select id="dr-basis" name="basis" defaultValue="PERCENT_OF_BASIC">
                  {Object.entries(BASIS_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-3">
              <Field label="Employee %" htmlFor="dr-emp" hint="Percentage rules">
                <Input id="dr-emp" name="employeePercent" inputMode="decimal" className="!w-28" />
              </Field>
              <Field label="Employer %" htmlFor="dr-er" hint="Shown, never deducted">
                <Input id="dr-er" name="employerPercent" inputMode="decimal" className="!w-28" />
              </Field>
              <Field label="Fixed amount" htmlFor="dr-fixed" hint="Fixed rules">
                <Input id="dr-fixed" name="fixedAmount" inputMode="decimal" className="!w-32" />
              </Field>
              <Field label="Wage ceiling" htmlFor="dr-ceiling" hint="Cap on the base">
                <Input id="dr-ceiling" name="wageCeiling" inputMode="decimal" className="!w-32" />
              </Field>
              <Field label="Only if gross ≤" htmlFor="dr-elig" hint="Eligibility limit">
                <Input id="dr-elig" name="grossEligibilityMax" inputMode="decimal" className="!w-32" />
              </Field>
            </div>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
