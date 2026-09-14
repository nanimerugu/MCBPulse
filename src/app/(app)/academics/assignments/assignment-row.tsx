"use client";

import { useActionState } from "react";
import { Button, Select } from "@/components/ui";
import type { FormState } from "@/modules/sis/form-state";

export function AssignmentRow({
  action,
  branchId,
  sectionId,
  subjectId,
  currentStaffId,
  staff,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  branchId: string;
  sectionId: string;
  subjectId: string;
  currentStaffId: string | null;
  staff: { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="sectionId" value={sectionId} />
      <input type="hidden" name="subjectId" value={subjectId} />
      <Select name="staffId" defaultValue={currentStaffId ?? ""} required className="w-64" aria-label="Teacher">
        <option value="" disabled>
          Choose a teacher…
        </option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="secondary" disabled={pending} className="!py-1.5">
        {pending ? "Saving…" : currentStaffId ? "Change" : "Assign"}
      </Button>
      {state?.error ? <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span> : null}
      {state?.success ? <span className="text-xs text-emerald-700 dark:text-emerald-300">{state.success}</span> : null}
    </form>
  );
}
