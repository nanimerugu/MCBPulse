import { PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadSisAccess, param } from "@/modules/sis/access";
import { createStudentAction } from "@/app/(app)/students/actions";
import { StudentForm } from "@/app/(app)/students/student-form";

export default async function NewStudentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadSisAccess(param(sp, "branch"), "sis.students", "create");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="New student" />
        <AccessDenied result={result} permission="sis.students:create" />
      </>
    );
  }
  const { ctx } = result.access;

  return (
    <>
      <PageHeader title="New student" description={`Creates the record as an enquiry in ${ctx.branch.name}. Enroll them into a section from their profile.`} />
      <StudentForm action={createStudentAction} branchId={ctx.branch.id} submitLabel="Create student" />
    </>
  );
}
