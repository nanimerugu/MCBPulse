import { notFound } from "next/navigation";
import { withBranch } from "@/lib/branch-context";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, Input, LinkButton, PageHeader, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadExamsAccess, param } from "@/modules/sis/access";
import { getAttempt, getExam } from "@/modules/examcell/examcell.service";
import { ATTEMPT_STATUS_LABELS, summarizeAttempt } from "@/modules/examcell/grading";
import { isObjective, QUESTION_TYPE_LABELS } from "@/modules/examcell/paper";
import { gradeAttemptAction, recordAttemptAction } from "@/app/(app)/exams/actions";

export default async function AttemptPage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ attemptId }, sp] = await Promise.all([params, searchParams]);
  const result = await loadExamsAccess(param(sp, "branch"), "exams.exams", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Attempt" />
        <AccessDenied result={result} permission="exams.exams:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const scope = { organizationId: ctx.organizationId, branchId: ctx.branch.id };

  const [attempt, held] = await Promise.all([getAttempt(attemptId, scope), heldPermissionKeys(viewer.userId, ctx.organizationId)]);
  if (!attempt) notFound();
  const exam = await getExam(attempt.examId, scope);
  if (!exam) notFound();

  const paper = exam.papers[0];
  const hidden = { branchId: ctx.branch.id };
  const canEdit = held.has("exams.exams:edit");

  const totals = summarizeAttempt(
    attempt.answers.map((a) => ({ marksAwarded: a.marksAwarded, autoGraded: a.autoGraded, marks: a.examPaperQuestion.marks })),
  );
  const notRecorded = attempt.answers.length === 0;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={`${attempt.student.firstName} ${attempt.student.lastName}`}
        description={`${attempt.exam.title} · ${attempt.exam.subject.name} · out of ${attempt.exam.maxMarks}`}
        actions={<LinkButton href={withBranch(`/exams/${attempt.examId}`, ctx)}>Back to exam</LinkButton>}
      />

      <Card title="Attempt">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Badge tone={attempt.status === "GRADED" ? "green" : attempt.status === "SUBMITTED" ? "amber" : "neutral"}>
            {ATTEMPT_STATUS_LABELS[attempt.status].toLowerCase()}
          </Badge>
          {!notRecorded ? (
            <span className="text-zinc-600 dark:text-zinc-300">
              {totals.awarded}/{totals.possible} · {totals.autoGradedCount} auto-marked
              {totals.awaitingTeacher > 0 ? ` · ${totals.awaitingTeacher} awaiting you` : ""}
            </span>
          ) : null}
        </div>
        {totals.awaitingTeacher > 0 ? (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            No percentage is shown while anything is unmarked — a figure on a half-marked paper is a number that will change, shown as
            though it won&apos;t.
          </p>
        ) : null}
      </Card>

      {notRecorded && canEdit && paper ? (
        <Card title="Record this paper">
          <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
            For a paper sat on paper. Objective answers are marked as you save; the rest come back to you below.
          </p>
          <ActionForm action={recordAttemptAction.bind(null, attemptId, attempt.examId)} hidden={hidden} submitLabel="Save answers">
            <ol className="flex flex-col gap-4">
              {paper.questions.map((pq) => (
                <li key={pq.id}>
                  <p className="text-sm text-zinc-900 dark:text-zinc-50">
                    {pq.sequence}. {pq.question.text}{" "}
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">({pq.marks} mk)</span>
                  </p>
                  {isObjective(pq.question.type) ? (
                    <div className="mt-1.5 flex flex-col gap-1">
                      {pq.question.options.map((o) => (
                        <label key={o.id} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                          <input type="radio" name={`opt_${pq.id}`} value={o.id} />
                          {o.text}
                        </label>
                      ))}
                      <label className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                        <input type="radio" name={`opt_${pq.id}`} value="" defaultChecked />
                        Not answered
                      </label>
                    </div>
                  ) : (
                    <Textarea name={`txt_${pq.id}`} rows={2} maxLength={4000} placeholder="What the student wrote" className="mt-1.5" />
                  )}
                </li>
              ))}
            </ol>
          </ActionForm>
        </Card>
      ) : null}

      {!notRecorded ? (
        <Card title="Answers">
          {canEdit && totals.awaitingTeacher > 0 ? (
            <ActionForm action={gradeAttemptAction.bind(null, attemptId, attempt.examId)} hidden={hidden} submitLabel="Save marks">
              <ol className="flex flex-col gap-4">
                {attempt.answers.map((a) => (
                  <li key={a.id}>
                    <p className="text-sm text-zinc-900 dark:text-zinc-50">
                      {a.examPaperQuestion.sequence}. {a.examPaperQuestion.question.text}{" "}
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        ({a.examPaperQuestion.marks} mk · {QUESTION_TYPE_LABELS[a.examPaperQuestion.question.type]})
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      {a.selectedOptionId
                        ? (a.examPaperQuestion.question.options.find((o) => o.id === a.selectedOptionId)?.text ?? "—")
                        : (a.responseText ?? "Not answered")}
                    </p>
                    {a.autoGraded ? (
                      <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">Auto-marked {a.marksAwarded}/{a.examPaperQuestion.marks}</p>
                    ) : (
                      <div className="mt-1.5 flex flex-wrap items-end gap-2">
                        <Input
                          name={`mark_${a.id}`}
                          type="number"
                          min={0}
                          max={a.examPaperQuestion.marks}
                          defaultValue={a.marksAwarded ?? ""}
                          aria-label={`Marks for question ${a.examPaperQuestion.sequence}`}
                          className="!w-24"
                        />
                        <Input name={`fb_${a.id}`} maxLength={500} defaultValue={a.feedback ?? ""} placeholder="Feedback" />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </ActionForm>
          ) : (
            <ol className="flex flex-col gap-3">
              {attempt.answers.map((a) => (
                <li key={a.id} className="text-sm">
                  <p className="text-zinc-900 dark:text-zinc-50">
                    {a.examPaperQuestion.sequence}. {a.examPaperQuestion.question.text}
                  </p>
                  <p className="mt-0.5 text-zinc-600 dark:text-zinc-300">
                    {a.selectedOptionId
                      ? (a.examPaperQuestion.question.options.find((o) => o.id === a.selectedOptionId)?.text ?? "—")
                      : (a.responseText ?? "Not answered")}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {a.marksAwarded ?? "—"}/{a.examPaperQuestion.marks}
                    {a.autoGraded ? " · auto-marked" : ""}
                    {a.feedback ? ` · ${a.feedback}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      ) : !canEdit ? (
        <EmptyState>This attempt has no answers recorded.</EmptyState>
      ) : null}
    </div>
  );
}
