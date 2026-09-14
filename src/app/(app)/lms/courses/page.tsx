import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { db } from "@/lib/db";
import { Card, EmptyState, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadLmsAccess, param } from "@/modules/sis/access";
import { listCourses } from "@/modules/lms/courses.service";
import { listSubjects } from "@/modules/academics/subjects.service";
import { createCourseAction } from "@/app/(app)/lms/actions";

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadLmsAccess(param(sp, "branch"), "lms.courses", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Courses" />
        <AccessDenied result={result} permission="lms.courses:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const [courses, subjects, grades, curricula, canCreate] = await Promise.all([
    listCourses(ctx.organizationId),
    listSubjects(ctx.organizationId),
    db.grade.findMany({ where: { branchId: ctx.branch.id, deletedAt: null }, orderBy: { sequence: "asc" } }),
    db.curriculum.findMany({ where: { organizationId: ctx.organizationId, deletedAt: null }, orderBy: { name: "asc" } }),
    authorize(viewer.userId, "lms.courses", "create", { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
  ]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Courses"
        description="Organization-wide. One course serves every section that teaches it; assignments are what target a section."
        actions={<LinkButton href={withBranch("/lms", ctx)}>← Learning</LinkButton>}
      />

      {courses.length === 0 ? (
        <EmptyState>No courses yet.</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">Course</th>
                <th className="px-4 py-2 font-medium">Subject</th>
                <th className="px-4 py-2 font-medium">Grade</th>
                <th className="px-4 py-2 font-medium">Modules</th>
                <th className="px-4 py-2 font-medium">Assignments</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {courses.map((c) => (
                <tr key={c.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                  <td className="px-4 py-2">
                    <Link href={withBranch(`/lms/courses/${c.id}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                      {c.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">{c.subject ? `${c.subject.name} (${c.subject.code})` : "—"}</td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">{c.grade?.name ?? "—"}</td>
                  <td className="px-4 py-2 text-zinc-500">{c._count.modules}</td>
                  <td className="px-4 py-2 text-zinc-500">{c._count.assignments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canCreate ? (
        <Card title="New course">
          <ActionForm action={createCourseAction} hidden={{ branchId: ctx.branch.id }} submitLabel="Create course" pendingLabel="Creating…" variant="primary">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Title" htmlFor="c-title">
                <Input id="c-title" name="title" placeholder="e.g. Mathematics — Grade 5" required />
              </Field>
              <Field label="Subject" htmlFor="c-subject">
                <Select id="c-subject" name="subjectId" defaultValue="">
                  <option value="">—</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Grade" htmlFor="c-grade">
                <Select id="c-grade" name="gradeId" defaultValue="">
                  <option value="">—</option>
                  {grades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Curriculum" htmlFor="c-curriculum">
                <Select id="c-curriculum" name="curriculumId" defaultValue="">
                  <option value="">—</option>
                  {curricula.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Description" htmlFor="c-description">
              <Textarea id="c-description" name="description" rows={2} />
            </Field>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
