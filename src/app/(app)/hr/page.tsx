import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { db } from "@/lib/db";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadHrAccess, param } from "@/modules/sis/access";
import { heldPermissionKeys } from "@/lib/rbac";
import { formatMoney, toMinor } from "@/modules/finance/money";
import { LEAVE_STATUS_TONES, leaveDayCount } from "@/modules/hr/leave";
import { PAYROLL_STATUS_LABELS, periodLabel } from "@/modules/hr/payroll";
import { formatDate } from "@/modules/sis/labels";

export default async function HrIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadHrAccess(param(sp, "branch"), "hr.org", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="HR" />
        <AccessDenied result={result} permission="hr.org:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const held = await heldPermissionKeys(viewer.userId, ctx.organizationId);

  const canSeePay = held.has("hr.compensation:view");

  const [headcount, unpaid, pendingLeave, runs] = await Promise.all([
    db.staff.count({ where: { organizationId: ctx.organizationId, branchId: ctx.branch.id, deletedAt: null, exitDate: null } }),
    // "N without a pay figure" is itself a fact about compensation, so it is
    // not counted at all for someone who may not see salaries.
    canSeePay
      ? db.staff.count({
          where: { organizationId: ctx.organizationId, branchId: ctx.branch.id, deletedAt: null, exitDate: null, monthlyGrossPay: null },
        })
      : Promise.resolve(0),
    db.leaveRequest.findMany({
      where: { staffId: { not: null }, status: "PENDING", staff: { organizationId: ctx.organizationId, branchId: ctx.branch.id, deletedAt: null } },
      include: { staff: { include: { user: true } } },
      orderBy: { fromDate: "asc" },
      take: 5,
    }),
    db.payrollRun.findMany({
      where: { organizationId: ctx.organizationId, branchId: ctx.branch.id },
      include: { payslips: { select: { netPay: true } } },
      orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
      take: 4,
    }),
  ]);

  // Every card is gated on the permission that actually opens it, so a head
  // teacher without hr.compensation never sees a door marked "salaries".
  const cards = [
    {
      href: "/hr/people",
      title: "People",
      description: canSeePay
        ? "The staff directory with department, position, pay and exit."
        : "The staff directory with department, position and joining dates.",
      need: "hr.org:view",
    },
    { href: "/hr/org", title: "Departments & positions", description: "The org chart every staff record points at.", need: "hr.org:view" },
    { href: "/hr/leave", title: "Staff leave", description: "Requests, clashes and approvals.", need: "hr.leave:view" },
    { href: "/hr/payroll", title: "Payroll", description: "Monthly runs, payslips and the ledger posting.", need: "hr.payroll:view" },
  ].filter((c) => held.has(c.need));

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="HR"
        description={`${ctx.branch.name} · ${headcount} active staff${unpaid > 0 ? ` · ${unpaid} without a pay figure` : ""}`}
      />

      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
        <p className="font-medium text-amber-900 dark:text-amber-200">Payroll here is arithmetic, not a statutory engine</p>
        <p className="mt-1 text-amber-800 dark:text-amber-300">
          Deductions are whatever percentage and fixed amount you enter on a run. MCBPulse does <strong>not</strong> compute PF, ESI,
          professional tax or TDS, and its figures are not a compliant payroll filing. Blueprint section 18 requires legal review before
          this is used to pay real people.
        </p>
      </div>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <li key={c.href}>
            <Link
              href={withBranch(c.href, ctx)}
              className="block h-full rounded-lg border border-zinc-200 p-4 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              <p className="font-medium text-zinc-900 dark:text-zinc-50">{c.title}</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{c.description}</p>
            </Link>
          </li>
        ))}
      </ul>

      {held.has("hr.leave:view") ? (
        <Card title="Leave awaiting a decision">
          {pendingLeave.length === 0 ? (
            <EmptyState>Nothing pending.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {pendingLeave.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">{l.staff?.user.name}</span>
                  <span className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                    {formatDate(l.fromDate)} – {formatDate(l.toDate)} · {leaveDayCount(l)} day{leaveDayCount(l) === 1 ? "" : "s"}
                    <Badge tone={LEAVE_STATUS_TONES[l.status]}>pending</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {held.has("hr.payroll:view") ? (
        <Card title="Recent payroll runs">
          {runs.length === 0 ? (
            <EmptyState>No payroll run yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {runs.map((r) => {
                const net = r.payslips.reduce((s, p) => s + toMinor(p.netPay), 0);
                return (
                  <li key={r.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                    <Link href={withBranch(`/hr/payroll/${r.id}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                      {periodLabel(r.periodMonth, r.periodYear)}
                    </Link>
                    <span className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                      {r.payslips.length} payslip{r.payslips.length === 1 ? "" : "s"} · {formatMoney(net)} net
                      <Badge tone={r.status === "PAID" ? "green" : r.status === "PROCESSED" ? "blue" : "neutral"}>
                        {PAYROLL_STATUS_LABELS[r.status].toLowerCase()}
                      </Badge>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
