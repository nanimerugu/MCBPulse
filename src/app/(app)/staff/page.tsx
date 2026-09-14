import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { Badge, EmptyState, LinkButton, PageHeader, SuccessBanner } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadSisAccess, param } from "@/modules/sis/access";
import { formatDate } from "@/modules/sis/labels";
import { listStaff } from "@/modules/sis/staff.service";

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadSisAccess(param(sp, "branch"), "sis.staff", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Staff" />
        <AccessDenied result={result} permission="sis.staff:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;

  const [staff, canCreate] = await Promise.all([
    listStaff(ctx.organizationId, ctx.branch.id),
    authorize(viewer.userId, "sis.staff", "create", { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Staff"
        description={`${ctx.branch.name} · ${staff.length} record${staff.length === 1 ? "" : "s"}`}
        actions={
          canCreate ? (
            <LinkButton href={withBranch("/staff/new", ctx)} variant="primary">
              New staff member
            </LinkButton>
          ) : null
        }
      />
      {param(sp, "created") ? <SuccessBanner message="Staff member created." /> : null}

      {staff.length === 0 ? (
        <EmptyState>No staff records in this branch yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Designation</th>
                <th className="px-4 py-2 font-medium">Joined</th>
                <th className="px-4 py-2 font-medium">Login</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {staff.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-300">{s.employeeCode}</td>
                  <td className="px-4 py-2 text-zinc-900 dark:text-zinc-50">{s.user.email}</td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">{s.designation}</td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">{formatDate(s.joinDate)}</td>
                  <td className="px-4 py-2">
                    <Badge tone={s.user.status === "ACTIVE" ? "green" : s.user.status === "INVITED" ? "amber" : "neutral"}>{s.user.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
