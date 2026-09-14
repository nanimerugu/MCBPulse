import Link from "next/link";
import { notFound } from "next/navigation";
import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { Badge, Button, Card, DescriptionList, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadFinanceAccess, param } from "@/modules/sis/access";
import { getInvoice } from "@/modules/finance/invoices.service";
import { INVOICE_STATUS_LABELS, PAYMENT_METHOD_LABELS, formatMoney, fromMinor, toMinor } from "@/modules/finance/money";
import { formatDate, fullName } from "@/modules/sis/labels";
import { cancelInvoiceAction, decideRefundAction, recordPaymentAction, requestRefundAction } from "@/app/(app)/finance/actions";
import type { InvoiceStatus } from "@/generated/prisma/enums";

const TONES: Record<InvoiceStatus, BadgeTone> = { PENDING: "neutral", PARTIAL: "amber", PAID: "green", OVERDUE: "red", CANCELLED: "neutral" };
const REFUND_TONES: Record<string, BadgeTone> = { REQUESTED: "amber", APPROVED: "blue", PROCESSED: "green", REJECTED: "neutral" };
const SOURCE_LABELS: Record<string, string> = { "library-fine": "Library fine", hostel: "Hostel", transport: "Transport" };

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const result = await loadFinanceAccess(param(sp, "branch"), "finance.invoices", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Invoice" />
        <AccessDenied result={result} permission="finance.invoices:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const tenant = { organizationId: ctx.organizationId, branchId: ctx.branch.id };

  const data = await getInvoice(id, ctx.organizationId);
  if (!data) notFound();
  const { invoice, timeline } = data;

  const [canPay, canRefund, canCancel] = await Promise.all([
    authorize(viewer.userId, "finance.payments", "pay", tenant),
    authorize(viewer.userId, "finance.payments", "refund", tenant),
    authorize(viewer.userId, "finance.invoices", "edit", tenant),
  ]);
  const hidden = { branchId: ctx.branch.id };
  const open = invoice.status !== "CANCELLED" && invoice.outstandingMinor > 0;
  const successfulPayments = invoice.payments.filter((p) => p.status === "SUCCESS");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={invoice.invoiceNumber}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={TONES[invoice.displayStatus]}>{INVOICE_STATUS_LABELS[invoice.displayStatus]}</Badge>
            <Link href={withBranch(`/students/${invoice.student.id}`, ctx)} className="underline">
              {fullName(invoice.student)}
            </Link>
            <span className="font-mono text-xs">{invoice.student.admissionNumber}</span>
            {invoice.student.currentSection ? <span>· {invoice.student.currentSection.grade.name} / {invoice.student.currentSection.name}</span> : null}
            <span>· due {formatDate(invoice.dueDate)}</span>
          </span>
        }
        actions={<LinkButton href={withBranch("/finance/invoices", ctx)}>← Invoices</LinkButton>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card title="Summary">
            <DescriptionList
              items={[
                { label: "Total", value: formatMoney(invoice.totalMinor) },
                { label: "Paid", value: formatMoney(invoice.paidMinor) },
                { label: "Outstanding", value: <span className="font-semibold">{formatMoney(invoice.outstandingMinor)}</span> },
                {
                  label: "For",
                  value: invoice.feeStructure?.name ?? (invoice.sourceKey ? (SOURCE_LABELS[invoice.sourceKey.split(":")[0] ?? ""] ?? "operations charge") : "ad hoc"),
                },
              ]}
            />
            <table className="mt-4 w-full text-left text-sm">
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {invoice.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-1.5 text-zinc-700 dark:text-zinc-200">
                      {l.feeHead.name}
                      {l.description ? <p className="text-xs text-zinc-500 dark:text-zinc-400">{l.description}</p> : null}
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs">{formatMoney(toMinor(l.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {invoice.lines.reduce((s, l) => s + toMinor(l.amount), 0) !== invoice.totalMinor ? (
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                Lines total {formatMoney(invoice.lines.reduce((s, l) => s + toMinor(l.amount), 0))}; the difference is concessions applied when the invoice was raised.
              </p>
            ) : null}
          </Card>

          <Card title={`Payments (${successfulPayments.length})`}>
            {successfulPayments.length === 0 ? <EmptyState>No payments yet.</EmptyState> : null}
            <div className="flex flex-col gap-3">
              {successfulPayments.map((p) => (
                <div key={p.id} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-zinc-900 dark:text-zinc-50">
                      <span className="font-mono text-xs">{p.receipt?.receiptNumber ?? "no receipt"}</span> · {PAYMENT_METHOD_LABELS[p.method]} · {formatDate(p.paidAt)}
                      {p.gatewayReference ? <span className="text-zinc-500"> · ref {p.gatewayReference}</span> : null}
                    </span>
                    <span className="font-mono font-semibold">{formatMoney(toMinor(p.amount))}</span>
                  </div>
                  {p.refunds.length > 0 ? (
                    <ul className="mt-2 flex flex-col gap-1 border-t border-zinc-200 pt-2 dark:border-zinc-800">
                      {p.refunds.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span>
                            Refund {formatMoney(toMinor(r.amount))} <Badge tone={REFUND_TONES[r.status] ?? "neutral"}>{r.status.toLowerCase()}</Badge> · {r.reason}
                          </span>
                          {canRefund && (r.status === "REQUESTED" || r.status === "APPROVED") ? (
                            <span className="flex gap-1">
                              {(r.status === "REQUESTED" ? (["APPROVED", "REJECTED"] as const) : (["PROCESSED", "REJECTED"] as const)).map((d) => (
                                <form key={d} action={decideRefundAction}>
                                  <input type="hidden" name="branchId" value={ctx.branch.id} />
                                  <input type="hidden" name="invoiceId" value={invoice.id} />
                                  <input type="hidden" name="refundId" value={r.id} />
                                  <input type="hidden" name="decision" value={d} />
                                  <Button type="submit" variant={d === "REJECTED" ? "danger" : "secondary"} className="!px-2 !py-0.5 text-xs">
                                    {d === "APPROVED" ? "Approve" : d === "PROCESSED" ? "Mark paid out" : "Reject"}
                                  </Button>
                                </form>
                              ))}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {canRefund ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-zinc-600 dark:text-zinc-300">Request a refund on this payment</summary>
                      <div className="mt-2">
                        <ActionForm action={requestRefundAction.bind(null, p.id, invoice.id)} hidden={hidden} submitLabel="Request refund" inline>
                          <Input name="amount" placeholder="Amount" required className="w-32" aria-label="Refund amount" inputMode="decimal" />
                          <Input name="reason" placeholder="Reason" required className="w-64" aria-label="Reason" />
                        </ActionForm>
                      </div>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>

          <Card title="Timeline">
            {timeline.length === 0 ? (
              <EmptyState>No events.</EmptyState>
            ) : (
              <ol className="flex flex-col gap-3 text-sm">
                {timeline.map((ev) => (
                  <li key={ev.id} className="border-l-2 border-zinc-200 pl-3 dark:border-zinc-800">
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">{ev.action.replace(/^(invoice|payment|refund)\./, "").replace(/_/g, " ")}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {ev.createdAt.toISOString().replace("T", " ").slice(0, 16)} · {ev.actorUser?.name ?? "system"}
                    </p>
                    {ev.after ? <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs text-zinc-600 dark:text-zinc-300">{JSON.stringify(ev.after)}</pre> : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {canPay && open ? (
            <Card title="Record a payment">
              <ActionForm action={recordPaymentAction.bind(null, invoice.id)} hidden={hidden} submitLabel="Record & issue receipt" pendingLabel="Recording…" variant="primary">
                <Field label="Amount" htmlFor="pay-amount" hint={`Outstanding ${formatMoney(invoice.outstandingMinor)} — partial payments are fine.`}>
                  <Input id="pay-amount" name="amount" defaultValue={fromMinor(invoice.outstandingMinor)} required inputMode="decimal" />
                </Field>
                <Field label="Method" htmlFor="pay-method">
                  <Select id="pay-method" name="method" defaultValue="CASH">
                    <option value="CASH">Cash</option>
                    <option value="BANK_TRANSFER">Bank transfer</option>
                    <option value="CHEQUE">Cheque</option>
                    <option value="ONLINE">Online (manual entry)</option>
                  </Select>
                </Field>
                <Field label="Paid on" htmlFor="pay-date">
                  <Input id="pay-date" name="paidAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
                </Field>
                <Field label="Reference (optional)" htmlFor="pay-ref">
                  <Input id="pay-ref" name="reference" placeholder="Cheque no. / UTR / gateway id" />
                </Field>
              </ActionForm>
            </Card>
          ) : null}

          {canCancel && invoice.status !== "CANCELLED" && successfulPayments.length === 0 ? (
            <Card title="Cancel invoice">
              <ActionForm action={cancelInvoiceAction.bind(null, invoice.id)} hidden={hidden} submitLabel="Cancel invoice" variant="danger">
                <Input name="reason" placeholder="Reason (optional)" aria-label="Reason" />
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Only an invoice with no payments can be cancelled. The audit trail is kept.</p>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
