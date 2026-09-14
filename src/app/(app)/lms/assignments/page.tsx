import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadLmsAccess, param } from "@/modules/sis/access";
import { getSectionScope, sectionInScope } from "@/modules/academics/scope";
import { listEnrollableSections } from "@/modules/sis/students.service";
import { listAssignments } from "@/modules/lms/assignments.service";
import { listCourses } from "@/modules/lms/courses.service";
import { formatDate } from "@/modules/sis/labels";
import { createAssignmentAction } from "@/app/(app)/lms/actions";

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadLmsAccess(param(sp, "branch"), "lms.assignments", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Assignments" />
        <AccessDenied result={result} permission="lms.assignments:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const scope = await getSectionScope(result.access);

  const allSections = await listEnrollableSections(ctx.branch.id);
  const sections = allSections.filter((s) => sectionInScope(scope, s.id));
  const requested = param(sp, "section");
  const sectionId = requested && sectionInScope(scope, requested) ? requested : undefined;

  const [assignments, courses, canCreate] = await Promise.all([
    listAssignments({ organizationId: ctx.organizationId, branchId: ctx.branch.id, sectionIds: scope.sectionIds, sectionId, includeDrafts: true }),
    listCourses(ctx.organizationId),
    authorize(viewer.userId, "lms.assignments", "create", { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Assignments"
        description={`${ctx.branch.name} · ${assignments.length} shown${scope.sectionIds !== null ? " · your sections only" : ""}`}
        actions={<LinkButton href={withBranch("/lms", ctx)}>← Learning</LinkButton>}
      />

      {sections.length === 0 ? (
        <EmptyState>{scope.sectionIds !== null ? "You aren't assigned to any section yet." : "No sections in the current academic year."}</EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-zinc-500 dark:text-zinc-400">Section:</span>
            <Link
              href={withBranch("/lms/assignments", ctx)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${!sectionId ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}
            >
              All
            </Link>
            {sections.map((s) => (
              <Link
                key={s.id}
                href={withBranch(`/lms/assignments?section=${s.id}`, ctx)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${s.id === sectionId ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}
              >
                {s.grade.name} / {s.name}
              </Link>
            ))}
          </div>

          {assignments.length === 0 ? (
            <EmptyState>No assignments yet.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">Title</th>
                    <th className="px-4 py-2 font-medium">Course</th>
                    <th className="px-4 py-2 font-medium">Section</th>
                    <th className="px-4 py-2 font-medium">Due</th>
                    <th className="px-4 py-2 text-right font-medium">Out of</th>
                    <th className="px-4 py-2 text-right font-medium">Recorded</th>
                    <th className="px-4 py-2 font-medium">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {assignments.map((a) => (
                    <tr key={a.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                      <td className="px-4 py-2">
                        <Link href={withBranch(`/lms/assignments/${a.id}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                          {a.title}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">{a.course.title}</td>
                      <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">{a.section ? `${a.section.grade.name} / ${a.section.name}` : "—"}</td>
                      <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">{formatDate(a.dueAt)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">{a.maxMarks}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">{a._count.submissions}</td>
                      <td className="px-4 py-2">{a.publishedAt ? <Badge tone="green">Published</Badge> : <Badge tone="neutral">Draft</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canCreate && courses.length > 0 ? (
            <Card title="New assignment">
              <ActionForm action={createAssignmentAction} hidden={{ branchId: ctx.branch.id }} submitLabel="Create as draft" pendingLabel="Creating…" variant="primary">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Course" htmlFor="a-course">
                    <Select id="a-course" name="courseId" required defaultValue={courses[0].id}>
                      {courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Section" htmlFor="a-section">
                    <Select id="a-section" name="sectionId" required defaultValue={sectionId ?? sections[0].id}>
                      {sections.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.grade.name} / {s.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Title" htmlFor="a-title">
                    <Input id="a-title" name="title" placeholder="e.g. Fractions worksheet 2" required />
                  </Field>
                  <Field label="Out of" htmlFor="a-max">
                    <Input id="a-max" name="maxMarks" type="number" min={1} defaultValue={20} required />
                  </Field>
                  <Field label="Due" htmlFor="a-due">
                    <Input id="a-due" name="dueAt" type="datetime-local" required />
                  </Field>
                </div>
                <Field label="Instructions" htmlFor="a-instructions">
                  <Textarea id="a-instructions" name="instructions" rows={2} />
                </Field>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Created as a draft — publish it from its own page when it&apos;s ready to be graded.</p>
              </ActionForm>
            </Card>
          ) : canCreate ? (
            <EmptyState>
              Create a{" "}
              <Link href={withBranch("/lms/courses", ctx)} className="underline">
                course
              </Link>{" "}
              first — an assignment belongs to one.
            </EmptyState>
          ) : null}
        </>
      )}
    </div>
  );
}
