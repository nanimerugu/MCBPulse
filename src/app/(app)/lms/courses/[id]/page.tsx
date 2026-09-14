import Link from "next/link";
import { notFound } from "next/navigation";
import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadLmsAccess, param } from "@/modules/sis/access";
import { getCourse } from "@/modules/lms/courses.service";
import { formatDate } from "@/modules/sis/labels";
import { addLessonAction, addModuleAction } from "@/app/(app)/lms/actions";

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const result = await loadLmsAccess(param(sp, "branch"), "lms.courses", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Course" />
        <AccessDenied result={result} permission="lms.courses:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const course = await getCourse(id, ctx.organizationId);
  if (!course) notFound();

  const canEdit = await authorize(viewer.userId, "lms.courses", "edit", { organizationId: ctx.organizationId, branchId: ctx.branch.id });
  const hidden = { branchId: ctx.branch.id };
  const lessonCount = course.modules.reduce((n, m) => n + m.lessons.length, 0);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={course.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {course.subject ? <Badge tone="blue">{course.subject.name}</Badge> : null}
            {course.grade ? <span>{course.grade.name}</span> : null}
            {course.curriculum ? <span>· {course.curriculum.name}</span> : null}
            <span>
              · {course.modules.length} module{course.modules.length === 1 ? "" : "s"}, {lessonCount} lesson{lessonCount === 1 ? "" : "s"}
            </span>
          </span>
        }
        actions={<LinkButton href={withBranch("/lms/courses", ctx)}>← Courses</LinkButton>}
      />

      {course.description ? <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">{course.description}</p> : null}

      <Card title="Content">
        {course.modules.length === 0 ? (
          <EmptyState>No modules yet. Add one below, then put lessons in it.</EmptyState>
        ) : (
          <ol className="flex flex-col gap-4">
            {course.modules.map((m) => (
              <li key={m.id}>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {m.sequence}. {m.title}
                </p>
                {m.lessons.length === 0 ? (
                  <p className="mt-1 pl-4 text-sm text-zinc-500 dark:text-zinc-400">No lessons yet.</p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-1 pl-4">
                    {m.lessons.map((l) => (
                      <li key={l.id} className="text-sm">
                        <span className="text-zinc-900 dark:text-zinc-50">
                          {m.sequence}.{l.sequence} {l.title}
                        </span>
                        {l.content ? <p className="text-xs text-zinc-500 dark:text-zinc-400">{l.content}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}

        {canEdit ? (
          <div className="mt-4 flex flex-col gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <ActionForm action={addModuleAction.bind(null, course.id)} hidden={hidden} submitLabel="Add module" inline>
              <Input name="title" placeholder="Module title, e.g. Fractions" required className="w-72" aria-label="Module title" />
            </ActionForm>
            {course.modules.length > 0 ? (
              <ActionForm action={addLessonAction.bind(null, course.id)} hidden={hidden} submitLabel="Add lesson">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Module" htmlFor="l-module">
                    <Select id="l-module" name="courseModuleId" required defaultValue={course.modules[0].id}>
                      {course.modules.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.sequence}. {m.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Lesson title" htmlFor="l-title">
                    <Input id="l-title" name="title" required />
                  </Field>
                </div>
                <Field label="Content" htmlFor="l-content" hint="Plain text for now; file and video resources arrive with the Files adapter.">
                  <Textarea id="l-content" name="content" rows={3} />
                </Field>
              </ActionForm>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card title={`Assignments from this course (${course.assignments.length})`}>
        {course.assignments.length === 0 ? (
          <EmptyState>None yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {course.assignments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <Link href={withBranch(`/lms/assignments/${a.id}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                  {a.title}
                </Link>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {a.section ? `${a.section.grade.name} / ${a.section.name}` : "—"} · due {formatDate(a.dueAt)}{" "}
                  {a.publishedAt ? <Badge tone="green">Published</Badge> : <Badge tone="neutral">Draft</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
