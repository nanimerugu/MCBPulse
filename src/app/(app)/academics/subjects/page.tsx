import { authorize } from "@/lib/rbac";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadAcademicsAccess, param } from "@/modules/sis/access";
import { listCurricula, listSubjects } from "@/modules/academics/subjects.service";
import { createCurriculumAction, createSubjectAction } from "@/app/(app)/academics/actions";
import { CurriculumForm, SubjectForm } from "@/app/(app)/academics/subjects/subject-forms";

export default async function SubjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadAcademicsAccess(param(sp, "branch"), "academics.subjects", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Subjects & curricula" />
        <AccessDenied result={result} permission="academics.subjects:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const [subjects, curricula, canConfigure] = await Promise.all([
    listSubjects(ctx.organizationId),
    listCurricula(ctx.organizationId),
    authorize(viewer.userId, "academics.subjects", "configure", { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
  ]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Subjects & curricula" description="Organization-wide — one Mathematics for every branch and grade that teaches it." />

      <Card title={`Subjects (${subjects.length})`}>
        {subjects.length === 0 ? (
          <EmptyState>No subjects yet.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="py-1 pr-4 font-medium">Code</th>
                <th className="py-1 pr-4 font-medium">Name</th>
                <th className="py-1 pr-4 font-medium">Assignments</th>
                <th className="py-1 font-medium">Timetable slots</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {subjects.map((s) => (
                <tr key={s.id}>
                  <td className="py-1.5 pr-4 font-mono text-xs">{s.code}</td>
                  <td className="py-1.5 pr-4 text-zinc-900 dark:text-zinc-50">{s.name}</td>
                  <td className="py-1.5 pr-4 text-zinc-500">{s._count.subjectAssignments}</td>
                  <td className="py-1.5 text-zinc-500">{s._count.timetableSlots}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canConfigure ? (
          <div className="mt-4">
            <SubjectForm action={createSubjectAction} branchId={ctx.branch.id} />
          </div>
        ) : null}
      </Card>

      <Card title={`Curricula (${curricula.length})`}>
        {curricula.length === 0 ? (
          <EmptyState>No curricula yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {curricula.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-1.5">
                <span className="text-zinc-900 dark:text-zinc-50">{c.name}</span>
                <span className="text-xs text-zinc-500">{c.type.replace("_", " ")}</span>
              </li>
            ))}
          </ul>
        )}
        {canConfigure ? (
          <div className="mt-4">
            <CurriculumForm action={createCurriculumAction} branchId={ctx.branch.id} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
