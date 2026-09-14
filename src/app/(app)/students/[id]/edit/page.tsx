import { notFound } from "next/navigation";
import { withBranch } from "@/lib/branch-context";
import { LinkButton, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadSisAccess, param } from "@/modules/sis/access";
import { formatDate, fullName } from "@/modules/sis/labels";
import { getStudent360 } from "@/modules/sis/students.service";
import { updateStudentAction } from "@/app/(app)/students/actions";
import { StudentForm } from "@/app/(app)/students/student-form";

export default async function EditStudentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const result = await loadSisAccess(param(sp, "branch"), "sis.students", "edit");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Edit student" />
        <AccessDenied result={result} permission="sis.students:edit" />
      </>
    );
  }
  const { ctx } = result.access;

  const data = await getStudent360(id, ctx.organizationId);
  if (!data) notFound();
  const s = data.student;

  return (
    <>
      <PageHeader
        title={`Edit ${fullName(s)}`}
        actions={<LinkButton href={withBranch(`/students/${s.id}`, ctx)}>Cancel</LinkButton>}
      />
      <StudentForm
        action={updateStudentAction.bind(null, s.id)}
        branchId={ctx.branch.id}
        submitLabel="Save changes"
        initial={{
          admissionNumber: s.admissionNumber,
          firstName: s.firstName,
          lastName: s.lastName,
          dateOfBirth: s.dateOfBirth ? formatDate(s.dateOfBirth) : "",
          gender: s.gender ?? "",
          addressLine1: s.addressLine1 ?? "",
          addressLine2: s.addressLine2 ?? "",
          city: s.city ?? "",
          state: s.state ?? "",
          postalCode: s.postalCode ?? "",
          bloodGroup: s.bloodGroup ?? "",
          medicalNotes: s.medicalNotes ?? "",
        }}
      />
    </>
  );
}
