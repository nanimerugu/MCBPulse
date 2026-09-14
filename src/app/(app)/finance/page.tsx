import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { Card, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadFinanceAccess, param } from "@/modules/sis/access";
import { listEnrollableSections } from "@/modules/sis/students.service";
import { duesSummary } from "@/modules/finance/invoices.service";
import { listFeeStructures } from "@/modules/finance/fees.service";
import { formatMoney } from "@/modules/finance/money";
import { raiseForSectionAction } from "@/app/(app)/finance/actions";

export default async function FinanceIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadFinanceAccess(param(sp, "branch"), "finance.invoices", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Finance" />
        <AccessDenied result={result} permission="finance.invoices:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const tenant = { organizationId: ctx.organizationId, branchId: ctx.branch.id };

  const [dues, canRaise, sections, structures] = await Promise.all([
    duesSummary(ctx.organizationId, ctx.branch.id),
    authorize(viewer.userId, "finance.invoices", "create", tenant),
    listEnrollableSections(ctx.branch.id),
    ctx.academicYear ? listFeeStructures(ctx.branch.id, ctx.academicYear.id) : Promise.resolve([]),
  ]);

  const cards = [
    { label: "Outstanding", value: formatMoney(dues.outstandingMinor), sub: `${dues.openInvoices} open invoice${dues.openInvoices === 1 ? "" : "s"}`, href: "/finance/invoices" },
    { label: "Overdue", value: formatMoney(dues.overdueMinor), sub: `${dues.overdueCount} invoice${dues.overdueCount === 1 ? "" : "s"} past due`, href: "/finance/invoices?status=OVERDUE" },
    { label: "Collected this month", value: formatMoney(dues.collectedThisMonthMinor), sub: "successful payments", href: "/finance/ledger" },
  ];

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Finance"
        description={`${ctx.branch.name}${ctx.academicYear ? ` · ${ctx.academicYear.name}` : ""}`}
        actions={
          <>
            <LinkButton href={withBranch("/finance/fee-structures", ctx)}>Fee structures</LinkButton>
            <LinkButton href={withBranch("/finance/ledger", ctx)}>Ledger</LinkButton>
            <LinkButton href={withBranch("/finance/invoices", ctx)} variant="primary">
              Invoices
            </LinkButton>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.label} href={withBranch(c.href, ctx)} className="rounded-lg border border-zinc-200 p-4 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
            <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{c.label}</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{c.value}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{c.sub}</p>
          </Link>
        ))}
      </div>

      {canRaise ? (
        <Card title="Raise invoices for a section">
          {!ctx.academicYear ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Flag an academic year as current first.</p>
          ) : structures.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No fee structures for {ctx.academicYear.name} yet —{" "}
              <Link href={withBranch("/finance/fee-structures", ctx)} className="underline">
                create one
              </Link>
              .
            </p>
          ) : (
            <ActionForm action={raiseForSectionAction} hidden={{ branchId: ctx.branch.id }} submitLabel="Raise invoices" pendingLabel="Raising…" variant="primary">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Section" htmlFor="rs-section">
                  <Select id="rs-section" name="sectionId" required defaultValue={sections[0]?.id ?? ""}>
                    {sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.grade.name} / {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Fee structure" htmlFor="rs-structure">
                  <Select id="rs-structure" name="feeStructureId" required defaultValue={structures[0]?.id ?? ""}>
                    {structures.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.grade ? ` (${s.grade.name})` : ""} · {formatMoney(s.totalMinor)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Due date" htmlFor="rs-due">
                  <Input id="rs-due" name="dueDate" type="date" required />
                </Field>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">One invoice per enrolled student; students already invoiced for this structure are skipped. Concessions apply automatically.</p>
            </ActionForm>
          )}
        </Card>
      ) : null}
    </div>
  );
}
