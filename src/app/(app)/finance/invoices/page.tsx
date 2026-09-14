import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { Badge, Button, EmptyState, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadFinanceAccess, param } from "@/modules/sis/access";
import { listInvoices } from "@/modules/finance/invoices.service";
import { INVOICE_STATUS_LABELS, formatMoney } from "@/modules/finance/money";
import { formatDate, fullName } from "@/modules/sis/labels";
import type { InvoiceStatus } from "@/generated/prisma/enums";

export const INVOICE_TONES: Record<InvoiceStatus, BadgeTone> = { PENDING: "neutral", PARTIAL: "amber", PAID: "green", OVERDUE: "red", CANCELLED: "neutral" };
const STATUSES: InvoiceStatus[] = ["PENDING", "PARTIAL", "OVERDUE", "PAID", "CANCELLED"];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadFinanceAccess(param(sp, "branch"), "finance.invoices", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Invoices" />
        <AccessDenied result={result} permission="finance.invoices:view" />
      </>
    );
  }
  const { ctx } = result.access;
  const q = param(sp, "q") ?? "";
  const statusParam = param(sp, "status") ?? "";
  const status = (STATUSES as string[]).includes(statusParam) ? (statusParam as InvoiceStatus) : undefined;
  const page = Math.max(1, Number(param(sp, "page") ?? "1") || 1);

  const data = await listInvoices({ organizationId: ctx.organizationId, branchId: ctx.branch.id, q, status, page });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Invoices" description={`${ctx.branch.name} · ${data.total} invoice${data.total === 1 ? "" : "s"}`} actions={<LinkButton href={withBranch("/finance", ctx)}>← Finance</LinkButton>} />

      <form method="get" action="/finance/invoices" className="flex flex-wrap items-end gap-3">
        {ctx.branches.length > 1 ? <input type="hidden" name="branch" value={ctx.branch.id} /> : null}
        <div className="min-w-64 flex-1">
          <Input name="q" defaultValue={q} placeholder="Invoice number, student name or admission number" aria-label="Search" />
        </div>
        <Select name="status" defaultValue={status ?? ""} aria-label="Status" className="w-44">
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {INVOICE_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      {data.items.length === 0 ? (
        <EmptyState>{q || status ? "No invoices match." : "No invoices yet — raise some from the Finance page or a student's profile."}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">Invoice</th>
                <th className="px-4 py-2 font-medium">Student</th>
                <th className="px-4 py-2 font-medium">Structure</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 text-right font-medium">Paid</th>
                <th className="px-4 py-2 text-right font-medium">Outstanding</th>
                <th className="px-4 py-2 font-medium">Due</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {data.items.map((inv) => (
                <tr key={inv.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link href={withBranch(`/finance/invoices/${inv.id}`, ctx)} className="text-zinc-900 hover:underline dark:text-zinc-50">
                      {inv.invoiceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">
                    {fullName(inv.student)} <span className="text-xs text-zinc-500">{inv.student.admissionNumber}</span>
                  </td>
                  <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{inv.feeStructure?.name ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{formatMoney(inv.totalMinor)}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{formatMoney(inv.paidMinor)}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs font-semibold">{formatMoney(inv.outstandingMinor)}</td>
                  <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{formatDate(inv.dueDate)}</td>
                  <td className="px-4 py-2">
                    <Badge tone={INVOICE_TONES[inv.displayStatus]}>{INVOICE_STATUS_LABELS[inv.displayStatus]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.pageCount > 1 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Page {data.page} of {data.pageCount}
        </p>
      ) : null}
    </div>
  );
}
