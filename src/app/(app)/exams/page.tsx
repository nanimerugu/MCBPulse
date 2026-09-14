import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { db } from "@/lib/db";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadExamsAccess, param } from "@/modules/sis/access";
import { listExams } from "@/modules/examcell/examcell.service";
import { examWindow } from "@/modules/examcell/grading";
import { getSectionScope, sectionInScope } from "@/modules/academics/scope";
import { formatDate } from "@/modules/sis/labels";
import { createExamAction } from "@/app/(app)/exams/actions";

export default async function ExamsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadExamsAccess(param(sp, "branch"), "exams.exams", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Exams" />
        <AccessDenied result={result} permission="exams.exams:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;

  const [allExams, held, scope, sections, subjects] = await Promise.all([
    listExams({ organizationId: ctx.organizationId, branchId: ctx.branch.id }),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
    getSectionScope(result.access),
    db.section.findMany({ where: { grade: { branchId: ctx.branch.id } }, include: { grade: true }, orderBy: [{ grade: { sequence: "asc" } }, { name: "asc" }] }),
    db.subject.findMany({ where: { organizationId: ctx.organizationId, deletedAt: null }, orderBy: { name: "asc" } }),
  ]);

  // A teacher sees the exams for sections they actually teach — the Phase 2
  // attribute policy applies here exactly as it does to the register.
  const exams = allExams.filter((e) => sectionInScope(scope, e.sectionId));
  const mySections = sections.filter((s) => sectionInScope(scope, s.id));

  const hidden = { branchId: ctx.branch.id };
  const now = new Date();

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Exams"
        description={`${exams.length} exam${exams.length === 1 ? "" : "s"} · ${ctx.branch.name}`}
        actions={held.has("exams.banks:view") ? <LinkButton href={withBranch("/exams/banks", ctx)}>Question banks</LinkButton> : undefined}
      />

      {held.has("exams.exams:create") && mySections.length > 0 && subjects.length > 0 ? (
        <Card title="Schedule an exam">
          <ActionForm action={createExamAction} hidden={hidden} submitLabel="Create exam">
            <Field label="Title" htmlFor="ex-title">
              <Input id="ex-title" name="title" required maxLength={120} placeholder="Mid-term — Fractions" />
            </Field>
            <div className="flex flex-wrap gap-3">
              <Field label="Section" htmlFor="ex-section">
                <Select id="ex-section" name="sectionId" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {mySections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.grade.name} / {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Subject" htmlFor="ex-subject">
                <Select id="ex-subject" name="subjectId" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-3">
              <Field label="When" htmlFor="ex-when" hint="Times are UTC.">
                <Input id="ex-when" name="scheduledAt" type="datetime-local" required />
              </Field>
              <Field label="Minutes" htmlFor="ex-mins">
                <Input id="ex-mins" name="durationMinutes" type="number" min={5} max={480} defaultValue={60} />
              </Field>
              <Field label="Out of" htmlFor="ex-marks">
                <Input id="ex-marks" name="maxMarks" type="number" min={1} max={1000} defaultValue={50} />
              </Field>
            </div>
            <Field label="Instructions" htmlFor="ex-inst">
              <Textarea id="ex-inst" name="instructions" rows={2} maxLength={1000} placeholder="Answer all questions. Calculators are not allowed." />
            </Field>
          </ActionForm>
        </Card>
      ) : null}

      <Card title="Exams">
        {exams.length === 0 ? (
          <EmptyState>No exams yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {exams.map((e) => {
              const window = examWindow(e.scheduledAt, e.durationMinutes, now);
              const paper = e.papers[0];
              return (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <Link href={withBranch(`/exams/${e.id}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                      {e.title}
                    </Link>
                    <p className="text-zinc-500 dark:text-zinc-400">
                      {e.section.grade.name}/{e.section.name} · {e.subject.name} · {formatDate(e.scheduledAt)} · {e.durationMinutes} min ·{" "}
                      out of {e.maxMarks}
                      {paper ? ` · paper v${paper.version} (${paper._count.questions} q)` : " · no paper yet"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {e.status === "PUBLISHED" ? <Badge tone={window === "open" ? "green" : window === "upcoming" ? "blue" : "neutral"}>{window}</Badge> : null}
                    <Badge tone={e.status === "PUBLISHED" ? "green" : e.status === "CLOSED" ? "neutral" : "amber"}>{e.status.toLowerCase()}</Badge>
                    {e._count.attempts > 0 ? <span className="text-xs text-zinc-500 dark:text-zinc-400">{e._count.attempts} sitting</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
