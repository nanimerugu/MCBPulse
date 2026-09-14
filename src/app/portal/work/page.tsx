import { Badge, Card, EmptyState, Field, Textarea, inputClass } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { ChildSwitcher } from "@/components/portal/child-switcher";
import { PortalDenied } from "@/components/portal/denial";
import { loadPortalPage } from "@/modules/portal/page-shell";
import { listOwnAssignments } from "@/modules/portal/submissions.service";
import { SUBMISSION_STATUS_LABELS } from "@/modules/lms/grading";
import { ALLOWED_EXTENSIONS, formatBytes, MAX_FILE_BYTES } from "@/modules/files/validation";
import { formatDate } from "@/modules/sis/labels";
import { param } from "@/modules/sis/access";
import { submitWorkAction } from "@/app/portal/actions";
import type { SubmissionStatus } from "@/generated/prisma/enums";

const TONES: Record<SubmissionStatus, BadgeTone> = { PENDING: "neutral", SUBMITTED: "blue", LATE: "amber", GRADED: "green" };

export default async function PortalWork({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const page = await loadPortalPage(param(sp, "child"));
  if (!page.ok) return <PortalDenied result={page.result} />;
  const { scope, studentId, children } = page;

  const assignments = await listOwnAssignments(scope, studentId);
  // Parents see the marks; only the student can hand work in.
  const canSubmit = scope.kind === "student";

  return (
    <div className="mx-auto max-w-2xl">
      <ChildSwitcher scope={scope} students={children} activeId={studentId} basePath="/portal/work" />
      <h1 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Work & marks</h1>

      {assignments === null ? (
        <EmptyState>Learning is not switched on at this school.</EmptyState>
      ) : assignments.length === 0 ? (
        <EmptyState>No published work yet.</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {assignments.map((a) => (
            <Card key={a.id} title={a.title}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <p className="text-zinc-500 dark:text-zinc-400">
                  {a.subject ? `${a.subject} · ` : ""}due {formatDate(a.dueAt)} · out of {a.maxMarks}
                </p>
                <div className="flex items-center gap-2">
                  {a.submission?.marksAwarded !== null && a.submission?.marksAwarded !== undefined ? (
                    <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
                      {a.submission.marksAwarded}/{a.maxMarks}
                    </span>
                  ) : null}
                  <Badge tone={TONES[a.status]}>{SUBMISSION_STATUS_LABELS[a.status].toLowerCase()}</Badge>
                </div>
              </div>

              {a.instructions ? <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{a.instructions}</p> : null}

              {a.submission?.responseText ? (
                <div className="mt-3 rounded-md bg-zinc-50 p-3 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">What was handed in</p>
                  {a.submission.responseText}
                </div>
              ) : null}
              {a.submission?.fileAsset ? (
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Attached: {a.submission.fileAsset.fileName}</p>
              ) : null}
              {a.submission?.feedback ? (
                <p className="mt-2 text-sm text-emerald-800 dark:text-emerald-300">Teacher: {a.submission.feedback}</p>
              ) : null}

              {canSubmit && a.canSubmit ? (
                <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                  <ActionForm
                    action={submitWorkAction.bind(null, a.id)}
                    hidden={{}}
                    submitLabel={a.submission?.submittedAt ? "Replace what I handed in" : "Hand in"}
                    pendingLabel="Sending…"
                  >
                    <Field label="Your answer" htmlFor={`w-${a.id}`}>
                      <Textarea id={`w-${a.id}`} name="responseText" rows={3} maxLength={4000} defaultValue={a.submission?.responseText ?? ""} />
                    </Field>
                    <Field
                      label="Or attach a file"
                      htmlFor={`f-${a.id}`}
                      hint={`Up to ${formatBytes(MAX_FILE_BYTES)}. ${ALLOWED_EXTENSIONS.join(", ")}.`}
                    >
                      <input id={`f-${a.id}`} name="file" type="file" className={inputClass} />
                    </Field>
                  </ActionForm>
                  {a.wouldBeLate ? (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                      This is past its due date. You can still hand it in — it will be marked late and your teacher decides what that means.
                    </p>
                  ) : null}
                </div>
              ) : canSubmit && !a.canSubmit ? (
                <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                  This has been marked, so it can&apos;t be changed. Talk to your teacher if something needs correcting.
                </p>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      {!canSubmit ? (
        <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-600">
          Work is handed in by the student from their own login — a parent can see the marks but not submit on their behalf.
        </p>
      ) : null}
    </div>
  );
}
