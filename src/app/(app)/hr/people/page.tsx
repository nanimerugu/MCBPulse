import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadHrAccess, param } from "@/modules/sis/access";
import { listStaffForHr } from "@/modules/hr/compensation.service";
import { formatMoney, toMinor } from "@/modules/finance/money";
import { formatDate } from "@/modules/sis/labels";

export default async function HrPeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadHrAccess(param(sp, "branch"), "hr.org", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="People" />
        <AccessDenied result={result} permission="hr.org:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;

  // Salary is a separate permission from the directory itself: this page
  // renders for anyone with hr.org:view, and the pay column simply isn't
  // fetched into the markup without hr.compensation:view.
  const [staff, canSeePay] = await Promise.all([
    listStaffForHr(ctx.organizationId, ctx.branch.id),
    authorize(viewer.userId, "hr.compensation", "view", { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
  ]);

  const active = staff.filter((s) => !s.exitDate);
  const exited = staff.filter((s) => s.exitDate);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="People"
        description={`${active.length} active · ${exited.length} exited`}
        actions={<LinkButton href={withBranch("/hr", ctx)}>Back to HR</LinkButton>}
      />

      <Card title="Staff">
        {staff.length === 0 ? (
          <EmptyState>No staff at this branch yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <tr>
                  <th className="py-2 pr-4 font-medium">Code</th>
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Department</th>
                  <th className="py-2 pr-4 font-medium">Position</th>
                  {canSeePay ? <th className="py-2 pr-4 text-right font-medium">Monthly gross</th> : null}
                  <th className="py-2 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {staff.map((s) => (
                  <tr key={s.id} className={s.exitDate ? "text-zinc-400 dark:text-zinc-600" : undefined}>
                    <td className="py-2 pr-4 font-mono text-xs">{s.employeeCode}</td>
                    <td className="py-2 pr-4">
                      <Link href={withBranch(`/hr/people/${s.id}`, ctx)} className="font-medium hover:underline">
                        {s.user.name}
                      </Link>
                      {s.exitDate ? (
                        <span className="ml-2">
                          <Badge tone="red">exited {formatDate(s.exitDate)}</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4">{s.department?.name ?? "—"}</td>
                    <td className="py-2 pr-4">{s.position?.title ?? s.designation}</td>
                    {canSeePay ? (
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {s.monthlyGrossPay === null ? (
                          <span className="text-amber-600 dark:text-amber-400">not set</span>
                        ) : (
                          formatMoney(toMinor(s.monthlyGrossPay))
                        )}
                      </td>
                    ) : null}
                    <td className="py-2">{formatDate(s.joinDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
