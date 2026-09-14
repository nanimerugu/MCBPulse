import { Badge, Card, EmptyState, Field, Input, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { getStaffSelf, listOwnLeave, listOwnPayslips, selfDenialMessage } from "@/modules/hr/self";
import { LEAVE_STATUS_LABELS, LEAVE_STATUS_TONES, leaveDayCount } from "@/modules/hr/leave";
import { formatMoney, toMinor } from "@/modules/finance/money";
import { periodLabel } from "@/modules/hr/payroll";
import { formatDate } from "@/modules/sis/labels";
import { requestOwnLeaveAction } from "@/app/(app)/my/actions";

export default async function MyLeavePage() {
  const result = await getStaffSelf();
  if (!result.ok) {
    const { title, body } = selfDenialMessage(result);
    return (
      <div className="mx-auto max-w-md rounded-lg border border-zinc-200 p-6 text-center dark:border-zinc-800">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{body}</p>
      </div>
    );
  }
  const { self } = result;
  const [leave, payslips] = await Promise.all([listOwnLeave(self), listOwnPayslips(self)]);

  const pending = leave.filter((l) => l.status === "PENDING").length;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="My leave & payslips"
        description={`${self.name} · ${self.employeeCode}${pending > 0 ? ` · ${pending} request${pending === 1 ? "" : "s"} awaiting a decision` : ""}`}
      />

      <Card title="Ask for leave">
        <ActionForm action={requestOwnLeaveAction} hidden={{}} submitLabel="Send request">
          <div className="flex flex-wrap gap-3">
            <Field label="From" htmlFor="ml-from">
              <Input id="ml-from" name="fromDate" type="date" required />
            </Field>
            <Field label="To" htmlFor="ml-to">
              <Input id="ml-to" name="toDate" type="date" required />
            </Field>
          </div>
          <Field label="Reason" htmlFor="ml-reason" hint="Overlapping one of your own pending or approved requests is refused.">
            <Input id="ml-reason" name="reason" required maxLength={500} placeholder="Medical leave" />
          </Field>
        </ActionForm>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          This page takes no HR permission. It resolves your own staff record and every query is built from it — there is nothing here that
          could show you a colleague&apos;s leave, because the request is never told whose leave to file.
        </p>
      </Card>

      <Card title="My requests">
        {leave.length === 0 ? (
          <EmptyState>You haven&apos;t asked for any leave.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {leave.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {formatDate(l.fromDate)} – {formatDate(l.toDate)}
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {" "}
                    · {leaveDayCount(l)} day{leaveDayCount(l) === 1 ? "" : "s"} · {l.reason}
                  </span>
                </span>
                <Badge tone={LEAVE_STATUS_TONES[l.status]}>{LEAVE_STATUS_LABELS[l.status].toLowerCase()}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="My payslips">
        {payslips.length === 0 ? (
          <EmptyState>No processed payslips yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {payslips.map((p) => (
              <li key={p.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">{periodLabel(p.payrollRun.periodMonth, p.payrollRun.periodYear)}</span>
                  <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                    {formatMoney(toMinor(p.grossPay))} − {formatMoney(toMinor(p.deductions))} = <strong>{formatMoney(toMinor(p.netPay))}</strong>
                    <span className="ml-2">
                      <Badge tone={p.payrollRun.status === "PAID" ? "green" : "neutral"}>{p.payrollRun.status.toLowerCase()}</Badge>
                    </span>
                  </span>
                </div>
                {p.lines.length > 0 ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-zinc-500 dark:text-zinc-400">
                      How this was worked out{p.payableDays !== null && p.daysInPeriod !== null ? ` · ${p.payableDays} of ${p.daysInPeriod} days paid` : ""}
                    </summary>
                    <ul className="mt-1 flex flex-col gap-0.5 text-xs text-zinc-600 dark:text-zinc-300">
                      {p.lines.map((l) => (
                        <li key={l.id} className="flex justify-between gap-3">
                          <span>
                            {l.label}
                            {l.detail ? <span className="text-zinc-400 dark:text-zinc-500"> · {l.detail}</span> : null}
                          </span>
                          <span className="tabular-nums">
                            {(l.kind === "DEDUCTION" || l.kind === "LOSS_OF_PAY") && toMinor(l.amount) > 0 ? "−" : ""}
                            {formatMoney(toMinor(l.amount))}
                            {l.kind === "EMPLOYER_CONTRIBUTION" ? " (paid by the school)" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Draft runs are not shown — a payslip you have been shown must not change underneath you. Your own payslip needs no
          <code className="mx-1 text-xs">hr.compensation</code> permission; that one is about seeing other people&apos;s pay.
        </p>
      </Card>
    </div>
  );
}
