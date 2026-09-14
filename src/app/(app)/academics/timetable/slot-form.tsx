"use client";

import { useActionState } from "react";
import { Button, ErrorBanner, Field, Input, Select, SuccessBanner } from "@/components/ui";
import type { FormState } from "@/modules/sis/form-state";
import { DAYS, DAY_LABELS } from "@/modules/academics/timetable-conflicts";

export function SlotForm({
  action,
  branchId,
  sectionId,
  subjects,
  staff,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  branchId: string;
  sectionId: string;
  /** Subjects with their assigned teacher for this section, when known. */
  subjects: { id: string; label: string; assignedStaffId: string | null }[];
  staff: { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="sectionId" value={sectionId} />
      <ErrorBanner message={state?.error} />
      <SuccessBanner message={state?.success} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Subject" htmlFor="slot-subject" error={fe.subjectId}>
          <Select id="slot-subject" name="subjectId" required className="w-44" defaultValue={subjects[0]?.id ?? ""}>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Teacher" htmlFor="slot-staff" error={fe.staffId} hint="Defaults aren't enforced — pick the assigned teacher unless it's a substitution.">
          <Select id="slot-staff" name="staffId" required className="w-56" defaultValue={subjects[0]?.assignedStaffId ?? staff[0]?.id ?? ""}>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Day" htmlFor="slot-day" error={fe.dayOfWeek}>
          <Select id="slot-day" name="dayOfWeek" required className="w-28" defaultValue="MONDAY">
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {DAY_LABELS[d]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Start" htmlFor="slot-start" error={fe.startTime}>
          <Input id="slot-start" name="startTime" type="time" required className="w-28" defaultValue="09:00" />
        </Field>
        <Field label="End" htmlFor="slot-end" error={fe.endTime}>
          <Input id="slot-end" name="endTime" type="time" required className="w-28" defaultValue="09:45" />
        </Field>
        <Field label="Room" htmlFor="slot-room" error={fe.room}>
          <Input id="slot-room" name="room" placeholder="optional" className="w-28" />
        </Field>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Adding…" : "Add slot"}
        </Button>
      </div>
    </form>
  );
}
