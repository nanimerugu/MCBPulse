import { withBranch } from "@/lib/branch-context";
import { LinkButton, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadSisAccess, param } from "@/modules/sis/access";
import { listStaffRoles } from "@/modules/sis/staff.service";
import { createStaffAction } from "@/app/(app)/staff/actions";
import { StaffForm } from "@/app/(app)/staff/staff-form";

export default async function NewStaffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadSisAccess(param(sp, "branch"), "sis.staff", "create");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="New staff member" />
        <AccessDenied result={result} permission="sis.staff:create" />
      </>
    );
  }
  const { ctx } = result.access;
  const roles = await listStaffRoles();

  return (
    <>
      <PageHeader
        title="New staff member"
        description={`Creates the employee record, a login, and a role assignment scoped to ${ctx.branch.name}.`}
        actions={<LinkButton href={withBranch("/staff", ctx)}>Cancel</LinkButton>}
      />
      <StaffForm action={createStaffAction} branchId={ctx.branch.id} roles={roles} />
    </>
  );
}
