"use client";

import { useActionState } from "react";
import { Badge, Button, ErrorBanner, SuccessBanner } from "@/components/ui";
import type { FormState } from "@/modules/sis/form-state";
import { ATTENDANCE_STATUSES, ATTENDANCE_STATUS_LABELS } from "@/modules/academics/attendance-summary";
import type { RegisterRow } from "@/modules/academics/attendance.service";

export function RegisterForm({
  action,
  branchId,
  sectionId,
  date,
  rows,
  editable,
  locked,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  branchId: string;
  sectionId: string;
  date: string;
  rows: RegisterRow[];
  editable: boolean;
  locked: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="sectionId" value={sectionId} />
      <input type="hidden" name="date" value={date} />
      <ErrorBanner message={state?.error} />
      <SuccessBanner message={state?.success} />

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">Student</th>
              {ATTENDANCE_STATUSES.map((s) => (
                <th key={s} className="px-2 py-2 text-center font-medium">
                  {ATTENDANCE_STATUS_LABELS[s]}
                </th>
              ))}
              <th className="px-3 py-2 font-medium">Remarks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map((r) => (
              <tr key={r.studentId}>
                <td className="px-3 py-1.5">
                  <span className="text-zinc-900 dark:text-zinc-50">{r.name}</span>{" "}
                  <span className="font-mono text-xs text-zinc-500">{r.admissionNumber}</span>
                  {r.onApprovedLeave ? (
                    <>
                      {" "}
                      <Badge tone="blue">On leave</Badge>
                    </>
                  ) : null}
                  {r.version !== null ? <input type="hidden" name={`version:${r.studentId}`} value={r.version} /> : null}
                </td>
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
                    className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editable ? (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending || rows.length === 0}>
            {pending ? "Saving…" : locked ? "Save correction (locked register)" : "Save register"}
          </Button>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Saving re-checks each row&apos;s version — if a colleague saved first, you&apos;ll be asked to reload.
          </span>
        </div>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {locked ? "This register is locked. Someone with approval rights can unlock it or correct it." : "You can view but not change this register."}
        </p>
      )}
    </form>
  );
}
