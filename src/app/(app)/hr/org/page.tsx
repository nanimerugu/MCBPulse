import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { Card, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadHrAccess, param } from "@/modules/sis/access";
import { listDepartments, listPositions } from "@/modules/hr/org.service";
import { createDepartmentAction, createPositionAction } from "@/app/(app)/hr/actions";

export default async function HrOrgPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadHrAccess(param(sp, "branch"), "hr.org", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Departments & positions" />
        <AccessDenied result={result} permission="hr.org:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const [departments, positions, canConfigure] = await Promise.all([
    listDepartments(ctx.organizationId),
    listPositions(ctx.organizationId),
    authorize(viewer.userId, "hr.org", "configure", { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
  ]);

  const hidden = { branchId: ctx.branch.id };
  const unassigned = positions.filter((p) => !p.departmentId);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Departments & positions"
        description="Organization-wide, not per-campus: a trust's Mathematics department is the same department at every branch."
        actions={<LinkButton href={withBranch("/hr", ctx)}>Back to HR</LinkButton>}
      />

      {canConfigure ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card title="Add a department">
            <ActionForm action={createDepartmentAction} hidden={hidden} submitLabel="Add department">
              <Field label="Name" htmlFor="dept-name">
                <Input id="dept-name" name="name" required maxLength={80} placeholder="Mathematics" />
              </Field>
            </ActionForm>
          </Card>

          <Card title="Add a position">
            <ActionForm action={createPositionAction} hidden={hidden} submitLabel="Add position">
              <Field label="Title" htmlFor="pos-title">
                <Input id="pos-title" name="title" required maxLength={80} placeholder="Senior Teacher" />
              </Field>
              <Field label="Department" htmlFor="pos-dept" hint="Optional — a position can sit outside any department.">
                <Select id="pos-dept" name="departmentId" defaultValue="">
                  <option value="">No department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </ActionForm>
          </Card>
        </div>
      ) : null}

      <Card title={`Org chart · ${departments.length} department${departments.length === 1 ? "" : "s"}`}>
        {departments.length === 0 && positions.length === 0 ? (
          <EmptyState>No departments or positions yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {departments.map((d) => (
              <li key={d.id} className="py-3">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{d.name}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {d._count.staff} staff · {d.positions.length} position{d.positions.length === 1 ? "" : "s"}
                  </p>
                </div>
                {d.positions.length > 0 ? (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {d.positions.map((p) => (
                      <li
                        key={p.id}
                        className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                      >
                        {p.title}
                        <span className="ml-1 text-zinc-400 dark:text-zinc-500">{p._count.staff}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
            {unassigned.length > 0 ? (
              <li className="py-3">
                <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Positions without a department</p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {unassigned.map((p) => (
                    <li key={p.id} className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {p.title}
                    </li>
                  ))}
                </ul>
              </li>
            ) : null}
          </ul>
        )}
      </Card>
    </div>
  );
}
