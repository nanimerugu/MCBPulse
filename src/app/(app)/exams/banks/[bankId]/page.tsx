import { notFound } from "next/navigation";
import { withBranch } from "@/lib/branch-context";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadExamsAccess, param } from "@/modules/sis/access";
import { getBank } from "@/modules/examcell/examcell.service";
import { DIFFICULTIES, isObjective, QUESTION_TYPES, QUESTION_TYPE_LABELS } from "@/modules/examcell/paper";
import { addQuestionAction, retireQuestionAction } from "@/app/(app)/exams/actions";

export default async function BankPage({
  params,
  searchParams,
}: {
  params: Promise<{ bankId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ bankId }, sp] = await Promise.all([params, searchParams]);
  const result = await loadExamsAccess(param(sp, "branch"), "exams.banks", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Question bank" />
        <AccessDenied result={result} permission="exams.banks:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const [bank, held] = await Promise.all([
    getBank(bankId, { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
  ]);
  if (!bank) notFound();

  const hidden = { branchId: ctx.branch.id };
  const byType = new Map(QUESTION_TYPES.map((t) => [t, bank.questions.filter((q) => q.type === t).length]));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={bank.name}
        description={`${bank.subject.name} · ${bank.questions.length} question${bank.questions.length === 1 ? "" : "s"}`}
        actions={<LinkButton href={withBranch("/exams/banks", ctx)}>All banks</LinkButton>}
      />

      <Card title="What's in here">
        <ul className="flex flex-wrap gap-2 text-xs">
          {QUESTION_TYPES.map((t) => (
            <li key={t} className="rounded-full bg-zinc-100 px-2.5 py-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {QUESTION_TYPE_LABELS[t]}: {byType.get(t) ?? 0}
            </li>
          ))}
          {DIFFICULTIES.map((d) => (
            <li key={d} className="rounded-full bg-zinc-100 px-2.5 py-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {d.toLowerCase()}: {bank.questions.filter((q) => q.difficulty === d).length}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Paper generation draws from these counts. If it refuses, it names exactly which line the bank is short on.
        </p>
      </Card>

      {held.has("exams.banks:create") ? (
        <Card title="Add a question">
          <ActionForm action={addQuestionAction.bind(null, bankId)} hidden={hidden} submitLabel="Add question">
            <div className="flex flex-wrap gap-3">
              <Field label="Type" htmlFor="q-type">
                <Select id="q-type" name="type" defaultValue="MCQ">
                  {QUESTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {QUESTION_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Difficulty" htmlFor="q-diff">
                <Select id="q-diff" name="difficulty" defaultValue="MEDIUM">
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {d.toLowerCase()}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Marks" htmlFor="q-marks">
                <Input id="q-marks" name="marks" type="number" min={1} max={100} defaultValue={1} />
              </Field>
            </div>
            <Field label="Question" htmlFor="q-text">
              <Textarea id="q-text" name="text" rows={2} required maxLength={2000} />
            </Field>

            <fieldset className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Options — multiple choice and true/false only
              </legend>
              <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
                Leave blanks for fewer options. Exactly one must be correct, because auto-marking compares against a single answer.
              </p>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="mb-2 flex items-center gap-2">
                  <input type="radio" name="correctIndex" value={i} defaultChecked={i === 0} aria-label={`Option ${i + 1} is correct`} />
                  <Input name={`option${i}`} maxLength={300} placeholder={`Option ${i + 1}`} />
                </div>
              ))}
            </fieldset>

            <Field label="Answer key" htmlFor="q-key" hint="Short answer and essay only — for the marker, never shown to a student before grading.">
              <Input id="q-key" name="correctAnswer" maxLength={1000} />
            </Field>
          </ActionForm>
        </Card>
      ) : null}

      <Card title="Questions">
        {bank.questions.length === 0 ? (
          <EmptyState>No questions yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {bank.questions.map((q) => (
              <li key={q.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-zinc-900 dark:text-zinc-50">{q.text}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone="neutral">{QUESTION_TYPE_LABELS[q.type]}</Badge>
                    <Badge tone={q.difficulty === "HARD" ? "red" : q.difficulty === "EASY" ? "green" : "amber"}>{q.difficulty.toLowerCase()}</Badge>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{q.marks} mk</span>
                  </div>
                </div>
                {isObjective(q.type) && q.options.length > 0 ? (
                  <ol className="mt-1.5 flex flex-col gap-0.5 text-xs text-zinc-600 dark:text-zinc-300">
                    {q.options.map((o) => (
                      <li key={o.id} className={o.isCorrect ? "font-medium text-emerald-700 dark:text-emerald-400" : undefined}>
                        {o.sequence}. {o.text} {o.isCorrect ? "✓" : ""}
                      </li>
                    ))}
                  </ol>
                ) : q.correctAnswer ? (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Key: {q.correctAnswer}</p>
                ) : null}
                <div className="mt-1.5 flex items-center gap-3">
                  {q._count.inPapers > 0 ? (
                    <span className="text-xs text-zinc-400 dark:text-zinc-600">
                      on {q._count.inPapers} paper{q._count.inPapers === 1 ? "" : "s"} — retiring keeps those intact
                    </span>
                  ) : null}
                  {held.has("exams.banks:edit") ? (
                    <ActionForm action={retireQuestionAction.bind(null, bankId, q.id)} hidden={hidden} submitLabel="Retire" variant="danger" inline />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
