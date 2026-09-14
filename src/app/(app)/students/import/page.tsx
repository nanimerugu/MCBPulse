import { withBranch } from "@/lib/branch-context";
import { LinkButton, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadSisAccess, param } from "@/modules/sis/access";
import { commitImportAction, previewImportAction } from "@/app/(app)/students/actions";
import { ImportForm } from "@/app/(app)/students/import/import-form";

export default async function ImportStudentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadSisAccess(param(sp, "branch"), "sis.students", "create");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Import students" />
        <AccessDenied result={result} permission="sis.students:create" />
      </>
    );
  }
  const { ctx } = result.access;

  return (
    <>
      <PageHeader
        title="Import students"
        description={
          <>
            Into {ctx.branch.name}
            {ctx.academicYear ? `, ${ctx.academicYear.name}` : ""}. Rows with a grade and section are enrolled; rows without are created as
            enquiries. A guardian per row is optional and is matched to an existing parent by phone.
          </>
        }
        actions={
          <>
            <LinkButton href="/students/import/template">Download template</LinkButton>
            <LinkButton href={withBranch("/students", ctx)}>Cancel</LinkButton>
          </>
        }
      />
      <ImportForm previewAction={previewImportAction} commitAction={commitImportAction} branchId={ctx.branch.id} />
    </>
  );
}
