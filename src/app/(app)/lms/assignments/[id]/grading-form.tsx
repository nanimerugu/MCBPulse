"use client";

import { useActionState } from "react";
import { Badge, Button, ErrorBanner, SuccessBanner, inputClass } from "@/components/ui";
import type { FormState } from "@/modules/sis/form-state";
import type { RosterRow } from "@/modules/lms/assignments.service";

/**
 * The grading roster. Each row posts four fields keyed by student id; the
 * `version` hidden input is the optimistic-lock token the server checks, so
 * a colleague's save in the meantime is caught rather than silently lost.
 */
export function GradingForm({
  action,
  branchId,
  sectionId,
  rows,
  maxMarks,
  editable,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  branchId: string;
  sectionId: string;
  rows: RosterRow[];
  maxMarks: number;
  editable: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="sectionId" value={sectionId} />
      <ErrorBanner message={state?.error} />
      <SuccessBanner message={state?.success} />

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">Student</th>
              <th className="px-3 py-2 font-medium">Submitted on</th>
              <th className="px-3 py-2 font-medium">Marks (of {maxMarks})</th>
              <th className="px-3 py-2 font-medium">Feedback</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map((r) => (
              <tr key={r.studentId}>
                <td className="px-3 py-1.5">
                  <span className="text-zinc-900 dark:text-zinc-50">{r.name}</span>{" "}
                  <span className="font-mono text-xs text-zinc-500">{r.admissionNumber}</span>
                  {r.wasLate ? (
                    <>
                      {" "}
                      <Badge tone="amber">Late</Badge>
                    </>
                  ) : null}
                  {r.version !== null ? <input type="hidden" name={`version:${r.studentId}`} value={r.version} /> : null}
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="date"
                    name={`submitted:${r.studentId}`}
                    defaultValue={r.submittedAt ? r.submittedAt.toISOString().slice(0, 10) : ""}
                    disabled={!editable}
                    aria-label={`${r.name}: submitted on`}
                    className={`${inputClass} !w-40 !py-1 text-xs`}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    name={`marks:${r.studentId}`}
                    defaultValue={r.marksAwarded ?? ""}
                    min={0}
                    max={maxMarks}
                    step={1}
                    disabled={!editable}
                    aria-label={`${r.name}: marks`}
                    className={`${inputClass} !w-24 !py-1 text-xs`}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    name={`feedback:${r.studentId}`}
                    defaultValue={r.feedback}
                    placeholder="optional"
                    disabled={!editable}
                    aria-label={`${r.name}: feedback`}
                    className={`${inputClass} !py-1 text-xs`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editable ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || rows.length === 0}>
            {pending ? "Saving…" : "Save roster"}
          </Button>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            A date after the due date marks the work late. Grading needs a submission date — clear the marks to un-grade.
          </span>
        </div>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">You can view but not change this roster.</p>
      )}
    </form>
  );
}
