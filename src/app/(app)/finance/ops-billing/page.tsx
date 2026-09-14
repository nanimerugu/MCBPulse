import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { heldPermissionKeys } from "@/lib/rbac";
import { localDateISO } from "@/lib/time-zone";
import { Card, EmptyState, Field, Input, LinkButton, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadFinanceAccess, param } from "@/modules/sis/access";
import { formatMoney, fromMinor } from "@/modules/finance/money";
import { getOpsBillingOverview } from "@/modules/finance/ops-billing.service";
import { branchTimeZone } from "@/modules/connect/quiet-hours";
import { formatDate } from "@/modules/sis/labels";
import { chargeFineAction, runBillingAction, setLibraryFinePolicyAction, setMonthlyFeeAction, waiveFineAction } from "@/app/(app)/finance/ops-billing/actions";

export default async function OpsBillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadFinanceAccess(param(sp, "branch"), "finance.invoices", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Operations charges" />
        <AccessDenied result={result} permission="finance.invoices:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const [overview, held, tz] = await Promise.all([
    getOpsBillingOverview({ organizationId: ctx.organizationId, branchId: ctx.branch.id }),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
    branchTimeZone(ctx.branch.id),
  ]);
  const canConfigure = held.has("finance.fee_structures:configure");
  const canCharge = held.has("finance.invoices:create");
  const hidden = { branchId: ctx.branch.id };
  const today = localDateISO(new Date(), tz);
  const thisMonth = today.slice(0, 7);
  // Default due date: a fortnight out, which is what most schools give.
  const fortnight = new Date(`${today}T00:00:00Z`);
  fortnight.setUTCDate(fortnight.getUTCDate() + 14);
  const defaultDue = fortnight.toISOString().slice(0, 10);
  const money = (minor: number | null) => (minor === null ? "" : fromMinor(minor));

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Operations charges"
        description={`Library fines, hostel and transport fees for ${ctx.branch.name}`}
        actions={<LinkButton href={withBranch("/finance", ctx)}>← Finance</LinkButton>}
      />

      <Card title={`Library fines awaiting a decision (${overview.pendingFines.length})`}>
        {overview.pendingFines.length === 0 ? (
          <EmptyState>No fines waiting. A fine appears here when a student returns a book late while a fine rate is set.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {overview.pendingFines.map((f) => (
              <li key={f.id} className="flex flex-col gap-2 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <strong>{formatMoney(f.fineMinor)}</strong> · {f.title} ·{" "}
                    {f.student ? (
                      <Link href={withBranch(`/students/${f.student.id}`, ctx)} className="underline">
                        {f.student.firstName} {f.student.lastName}
                      </Link>
                    ) : (
                      "staff loan"
                    )}
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {" "}
                      · due {formatDate(f.dueAt)}, returned {formatDate(f.returnedAt)}
                    </span>
                  </span>
                </div>
                {canCharge ? (
                  <div className="flex flex-wrap items-end gap-3">
                    {f.student ? (
                      <ActionForm action={chargeFineAction.bind(null, f.id)} hidden={hidden} submitLabel="Charge to family" inline>
                        <Input name="dueDate" type="date" defaultValue={defaultDue} required aria-label="Due date" className="!w-40" />
                      </ActionForm>
                    ) : null}
                    <ActionForm action={waiveFineAction.bind(null, f.id)} hidden={hidden} submitLabel="Waive" variant="danger" inline>
                      <Input name="reason" required minLength={3} maxLength={300} placeholder="Why it's waived" aria-label="Reason for waiving" className="!w-56" />
                    </ActionForm>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          A fine is fixed when the book comes back, at the rate in force that day, and is never charged until someone here chooses to. Charging
          twice is impossible: the invoice is keyed to the loan.
        </p>
      </Card>

      <Card title="Bill a month of hostel and transport">
        {canCharge ? (
          <ActionForm action={runBillingAction} hidden={hidden} submitLabel="Raise invoices" pendingLabel="Billing…" variant="primary">
            <div className="flex flex-wrap gap-3">
              <Field label="Month" htmlFor="ob-month">
                <Input id="ob-month" name="month" type="month" required defaultValue={thisMonth} className="!w-44" />
              </Field>
              <Field label="Due date" htmlFor="ob-due">
                <Input id="ob-due" name="dueDate" type="date" required defaultValue={defaultDue} className="!w-44" />
              </Field>
            </div>
          </ActionForm>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">You can see the rates, but raising invoices needs finance.invoices:create.</p>
        )}
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Safe to run again: each hostel stay and each student&apos;s bus is billed at most once per month, so a second run only picks up what
          is new. Hostel is prorated by nights in the month; transport is a full month for everyone on a priced route when you run it. Only
          blocks and routes with a monthly fee are billed.
        </p>
      </Card>

      <Card title="Rates">
        <div className="flex flex-col gap-5">
          <section>
            <h3 className="mb-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">Library fine</h3>
            {canConfigure ? (
              <ActionForm action={setLibraryFinePolicyAction} hidden={hidden} submitLabel="Save" inline>
                <Field label="Per day late" htmlFor="lf-day">
                  <Input id="lf-day" name="perDay" inputMode="decimal" defaultValue={money(overview.policy.perDayMinor)} placeholder="no fine" className="!w-32" />
                </Field>
                <Field label="Cap per book" htmlFor="lf-cap">
                  <Input id="lf-cap" name="cap" inputMode="decimal" defaultValue={money(overview.policy.capMinor)} placeholder="no cap" className="!w-32" />
                </Field>
              </ActionForm>
            ) : (
              <p className="text-sm">
                {overview.policy.perDayMinor === null
                  ? "No fine is set."
                  : `${formatMoney(overview.policy.perDayMinor)} a day${overview.policy.capMinor !== null ? `, at most ${formatMoney(overview.policy.capMinor)} a book` : ""}.`}
              </p>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">Hostel, per block per month</h3>
            {overview.blocks.length === 0 ? (
              <EmptyState>No hostel blocks.</EmptyState>
            ) : (
              <ul className="flex flex-col gap-2">
                {overview.blocks.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      {b.name} <span className="text-xs text-zinc-500 dark:text-zinc-400">· {b.residents} resident{b.residents === 1 ? "" : "s"}</span>
                    </span>
                    {canConfigure ? (
                      <ActionForm action={setMonthlyFeeAction.bind(null, { kind: "hostel", id: b.id })} hidden={hidden} submitLabel="Save" inline>
                        <Input name="monthlyFee" inputMode="decimal" defaultValue={money(b.monthlyFeeMinor)} placeholder="not billed" aria-label={`${b.name} monthly fee`} className="!w-32" />
                      </ActionForm>
                    ) : (
                      <span>{b.monthlyFeeMinor === null ? "not billed" : formatMoney(b.monthlyFeeMinor)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">Transport, per route per month</h3>
            {overview.routes.length === 0 ? (
              <EmptyState>No routes.</EmptyState>
            ) : (
              <ul className="flex flex-col gap-2">
                {overview.routes.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      {r.name} <span className="text-xs text-zinc-500 dark:text-zinc-400">· {r.riders} rider{r.riders === 1 ? "" : "s"}</span>
                    </span>
                    {canConfigure ? (
                      <ActionForm action={setMonthlyFeeAction.bind(null, { kind: "transport", id: r.id })} hidden={hidden} submitLabel="Save" inline>
                        <Input name="monthlyFee" inputMode="decimal" defaultValue={money(r.monthlyFeeMinor)} placeholder="not billed" aria-label={`${r.name} monthly fee`} className="!w-32" />
                      </ActionForm>
                    ) : (
                      <span>{r.monthlyFeeMinor === null ? "not billed" : formatMoney(r.monthlyFeeMinor)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          Every rate is the school&apos;s: leave one blank and nothing is ever charged for it. Changing a rate never re-prices a fine already
          recorded or a month already billed.
        </p>
      </Card>
    </div>
  );
}
