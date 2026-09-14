import { Badge, Card, EmptyState } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import { ChildSwitcher } from "@/components/portal/child-switcher";
import { PortalDenied } from "@/components/portal/denial";
import { loadPortalPage } from "@/modules/portal/page-shell";
import { getFees } from "@/modules/portal/portal.service";
import { formatMoney, INVOICE_STATUS_LABELS } from "@/modules/finance/money";
import { formatDate } from "@/modules/sis/labels";
import { param } from "@/modules/sis/access";
import type { InvoiceStatus } from "@/generated/prisma/enums";

const TONES: Record<InvoiceStatus, BadgeTone> = {
  PENDING: "neutral",
  PARTIAL: "amber",
  PAID: "green",
  OVERDUE: "red",
  CANCELLED: "neutral",
};

export default async function PortalFees({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const page = await loadPortalPage(param(sp, "child"));
  if (!page.ok) return <PortalDenied result={page.result} />;
  const { scope, studentId, children } = page;

  // A student sees their own attendance and work, but not the family's money.
  if (scope.kind !== "parent") {
    return <EmptyState>Fees are shown to parents and guardians.</EmptyState>;
  }

  const fees = await getFees(studentId, scope.organizationId);

  return (
    <div className="mx-auto max-w-2xl">
      <ChildSwitcher scope={scope} students={children} activeId={studentId} basePath="/portal/fees" />
      <h1 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Fees</h1>

      {fees === null ? (
        <EmptyState>Fees are not switched on at this school.</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <Card title="Outstanding">
            {fees.outstandingMinor === 0 ? (
              <p className="text-sm text-emerald-700 dark:text-emerald-400">Nothing outstanding.</p>
            ) : (
              <p className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{formatMoney(fees.outstandingMinor)}</p>
            )}
          </Card>

          <Card title="Invoices">
            {fees.rows.length === 0 ? (
              <EmptyState>No invoices raised yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {fees.rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <div>
                      <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{r.number}</p>
                      <p className="text-zinc-700 dark:text-zinc-300">due {formatDate(r.dueDate)}</p>
                    </div>
                    <div className="text-right">
                      <p className="tabular-nums text-zinc-900 dark:text-zinc-50">
                        {formatMoney(r.outstandingMinor)}
                        <span className="ml-1 text-xs text-zinc-500 dark:text-zinc-400">of {formatMoney(r.totalMinor)}</span>
                      </p>
                      <Badge tone={TONES[r.status]}>{INVOICE_STATUS_LABELS[r.status].toLowerCase()}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <p className="text-xs text-zinc-400 dark:text-zinc-600">
            Online payment is not built. Pay at the school office, where a receipt is issued against the invoice.
          </p>
        </div>
      )}
    </div>
  );
}
