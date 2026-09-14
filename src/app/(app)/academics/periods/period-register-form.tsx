"use client";

import { useActionState } from "react";
import { Badge, Button, ErrorBanner, SuccessBanner } from "@/components/ui";
import type { FormState } from "@/modules/sis/form-state";
import { ATTENDANCE_STATUSES, ATTENDANCE_STATUS_LABELS } from "@/modules/academics/attendance-summary";
import type { PeriodRow } from "@/modules/academics/period-attendance.service";

/**
 * A lesson's register. Same shape as the daily register, plus a column that
 * shows what the DAILY register says — so a child present this morning and
 * missing from this lesson stands out instead of hiding in a list of names.
 */
export function PeriodRegisterForm({
  action,
  branchId,
  slotId,
  date,
  rows,
  editable,
  readOnlyReason,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  branchId: string;
  slotId: string;
  date: string;
  rows: PeriodRow[];
  editable: boolean;
  readOnlyReason: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="slotId" value={slotId} />
      <input type="hidden" name="date" value={date} />
      <ErrorBanner message={state?.error} />
      <SuccessBanner message={state?.success} />

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">Student</th>
              <th className="px-2 py-2 font-medium">Daily register</th>
              {ATTENDANCE_STATUSES.map((s) => (
                <th key={s} className="px-2 py-2 text-center font-medium">
                  {ATTENDANCE_STATUS_LABELS[s]}
                </th>
              ))}
              <th className="px-3 py-2 font-medium">Remarks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map((r) => {
              // The case this register exists for: in school, not in the lesson.
              const missingFromLesson = r.version !== null && r.status === "ABSENT" && (r.dailyStatus === "PRESENT" || r.dailyStatus === "LATE");
              return (
                <tr key={r.studentId} className={missingFromLesson ? "bg-amber-50 dark:bg-amber-950/20" : undefined}>
                  <td className="px-3 py-1.5">
                    <span className="text-zinc-900 dark:text-zinc-50">{r.name}</span> <span className="font-mono text-xs text-zinc-500">{r.admissionNumber}</span>
                    {r.onApprovedLeave ? (
                      <>
                        {" "}
                        <Badge tone="blue">On leave</Badge>
                      </>
                    ) : null}
                    {missingFromLesson ? (
                      <>
                        {" "}
                        <Badge tone="amber">in school, not in this lesson</Badge>
                      </>
                    ) : null}
                    {r.version !== null ? <input type="hidden" name={`version:${r.studentId}`} value={r.version} /> : null}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">{r.dailyStatus ? ATTENDANCE_STATUS_LABELS[r.dailyStatus] : "not taken"}</td>
                  {ATTENDANCE_STATUSES.map((s) => (
                    <td key={s} className="px-2 py-1.5 text-center">
                      <input
                        type="radio"
                        name={`status:${r.studentId}`}
                        value={s}
                        defaultChecked={r.status === s}
                        disabled={!editable}
                        aria-label={`${r.name}: ${ATTENDANCE_STATUS_LABELS[s]}`}
                        className="h-4 w-4"
                      />
                    </td>
                  ))}
                  <td className="px-3 py-1.5">
                    <input
                      name={`remarks:${r.studentId}`}
                      defaultValue={r.remarks}
                      disabled={!editable}
                      placeholder="optional"
                      aria-label={`${r.name}: remarks`}
                      className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editable ? (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending || rows.length === 0}>
            {pending ? "Saving…" : "Save lesson register"}
          </Button>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Families aren&apos;t messaged from here — the daily register does that, once.</span>
        </div>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{readOnlyReason ?? "You can view but not change this register."}</p>
      )}
    </form>
  );
}
