import Link from "next/link";
import { notFound } from "next/navigation";
import { withBranch } from "@/lib/branch-context";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, DescriptionList, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadExamsAccess, param } from "@/modules/sis/access";
import { getExam, listBanks } from "@/modules/examcell/examcell.service";
import { ATTEMPT_STATUS_LABELS, examWindow } from "@/modules/examcell/grading";
import { DIFFICULTIES, QUESTION_TYPES, QUESTION_TYPE_LABELS } from "@/modules/examcell/paper";
import { formatDate } from "@/modules/sis/labels";
import { generatePaperAction, publishExamAction } from "@/app/(app)/exams/actions";

export default async function ExamPage({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ examId }, sp] = await Promise.all([params, searchParams]);
  const result = await loadExamsAccess(param(sp, "branch"), "exams.exams", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Exam" />
        <AccessDenied result={result} permission="exams.exams:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const scope = { organizationId: ctx.organizationId, branchId: ctx.branch.id };

  const [exam, held, banks] = await Promise.all([getExam(examId, scope), heldPermissionKeys(viewer.userId, ctx.organizationId), listBanks(scope)]);
  if (!exam) notFound();

  const hidden = { branchId: ctx.branch.id };
  const paper = exam.papers[0];
  const window = examWindow(exam.scheduledAt, exam.durationMinutes, new Date());
  const subjectBanks = banks.filter((b) => b.subjectId === exam.subjectId);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={exam.title}
        description={`${exam.section.grade.name}/${exam.section.name} · ${exam.subject.name} · out of ${exam.maxMarks}`}
        actions={<LinkButton href={withBranch("/exams", ctx)}>All exams</LinkButton>}
      />

      <Card title="Exam">
        <DescriptionList
          items={[
            { label: "Status", value: <Badge tone={exam.status === "PUBLISHED" ? "green" : "amber"}>{exam.status.toLowerCase()}</Badge> },
            { label: "Scheduled", value: `${formatDate(exam.scheduledAt)} ${exam.scheduledAt.toISOString().slice(11, 16)} UTC` },
            { label: "Duration", value: `${exam.durationMinutes} minutes` },
            { label: "Window", value: exam.status === "PUBLISHED" ? window : "—" },
            { label: "Paper", value: paper ? `v${paper.version} · ${paper.questions.length} questions · ${paper.questions.reduce((s, q) => s + q.marks, 0)} marks` : "Not built" },
            { label: "Instructions", value: exam.instructions ?? "—" },
          ]}
        />
      </Card>

      {exam.status === "DRAFT" && held.has("exams.exams:create") ? (
        <Card title="Build the paper">
          {subjectBanks.length === 0 ? (
            <EmptyState>
              There is no question bank for {exam.subject.name} yet.{" "}
              <Link href={withBranch("/exams/banks", ctx)} className="underline">
                Create one
              </Link>
              .
            </EmptyState>
          ) : (
            <>
              <ActionForm action={generatePaperAction.bind(null, examId)} hidden={hidden} submitLabel="Build paper" pendingLabel="Building…">
                <div className="flex flex-wrap gap-3">
                  <Field label="From bank" htmlFor="gp-bank">
                    <Select id="gp-bank" name="bankId" required defaultValue={subjectBanks[0]?.id}>
                      {subjectBanks.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b._count.questions})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Seed" htmlFor="gp-seed" hint="Same seed, same paper — so a paper can be explained.">
                    <Input id="gp-seed" name="seed" inputMode="numeric" placeholder="e.g. 2026" />
                  </Field>
                </div>

                <fieldset className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    How many of each
                  </legend>
                  <div className="overflow-x-auto">
                    <table className="text-sm">
                      <thead>
                        <tr>
                          <th className="pr-3 text-left text-xs font-medium text-zinc-500" />
                          {DIFFICULTIES.map((d) => (
                            <th key={d} className="px-2 text-xs font-medium text-zinc-500">
                              {d.toLowerCase()}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {QUESTION_TYPES.map((t) => (
                          <tr key={t}>
                            <td className="pr-3 text-xs text-zinc-600 dark:text-zinc-300">{QUESTION_TYPE_LABELS[t]}</td>
                            {DIFFICULTIES.map((d) => (
                              <td key={d} className="px-1 py-1">
                                <input
                                  type="number"
                                  name={`n_${t}_${d}`}
                                  min={0}
                                  max={50}
                                  defaultValue={0}
                                  aria-label={`${d.toLowerCase()} ${QUESTION_TYPE_LABELS[t]} questions`}
                                  className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </fieldset>
              </ActionForm>
              <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                The total must come to exactly {exam.maxMarks} marks. If the bank is short, the refusal says which line and by how many —
                a nearly-right exam paper is worse than none.
              </p>
            </>
          )}
        </Card>
      ) : null}

      {paper ? (
        <Card title={`Paper v${paper.version}`}>
          <ol className="flex flex-col gap-2">
            {paper.questions.map((pq) => (
              <li key={pq.id} className="text-sm">
                <span className="text-zinc-500 dark:text-zinc-400">{pq.sequence}.</span>{" "}
                <span className="text-zinc-900 dark:text-zinc-50">{pq.question.text}</span>{" "}
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  ({pq.marks} mk · {QUESTION_TYPE_LABELS[pq.question.type]})
                </span>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {exam.status === "DRAFT" && paper && held.has("exams.exams:publish") ? (
        <Card title="Publish">
          <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
            Publishing freezes the paper and creates a row for every enrolled student, so &quot;who hasn&apos;t sat it&quot; is a query
            rather than an absence of evidence.
          </p>
          <ActionForm action={publishExamAction.bind(null, examId)} hidden={hidden} submitLabel="Publish exam" variant="primary" inline />
        </Card>
      ) : null}

      {exam.attempts.length > 0 ? (
        <Card title={`Attempts · ${exam.attempts.filter((a) => a.status === "GRADED").length} graded of ${exam.attempts.length}`}>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {exam.attempts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link href={withBranch(`/exams/attempts/${a.id}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                  {a.student.firstName} {a.student.lastName}
                </Link>
                <span className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                  {a.marksAwarded !== null ? `${a.marksAwarded}/${exam.maxMarks}` : `${a.answers.length} answer${a.answers.length === 1 ? "" : "s"}`}
                  <Badge tone={a.status === "GRADED" ? "green" : a.status === "SUBMITTED" ? "amber" : "neutral"}>
                    {ATTEMPT_STATUS_LABELS[a.status].toLowerCase()}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
