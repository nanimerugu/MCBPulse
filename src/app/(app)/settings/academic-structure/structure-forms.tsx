"use client";

import { useActionState } from "react";
import { Button, ErrorBanner, Field, Input, Select, SuccessBanner } from "@/components/ui";
import type { FormState } from "@/modules/sis/form-state";

export function GradeForm({
  action,
  branchId,
  nextSequence,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  branchId: string;
  nextSequence: number;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="branchId" value={branchId} />
      <div className="w-full">
        <ErrorBanner message={state?.error} />
        <SuccessBanner message={state?.success} />
      </div>
      <Field label="Grade name" htmlFor="grade-name" error={fe.name}>
        <Input id="grade-name" name="name" placeholder="e.g. Grade 6" required className="w-48" />
      </Field>
      <Field label="Order" htmlFor="grade-seq" error={fe.sequence} hint="Promotion moves upward through this order.">
        <Input id="grade-seq" name="sequence" type="number" min={0} defaultValue={nextSequence} required className="w-24" />
      </Field>
      <Button type="submit" disabled={pending} variant="secondary">
        {pending ? "Adding…" : "Add grade"}
      </Button>
    </form>
  );
}

export function SectionForm({
  action,
  branchId,
  grades,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  branchId: string;
  grades: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="branchId" value={branchId} />
      <div className="w-full">
        <ErrorBanner message={state?.error} />
        <SuccessBanner message={state?.success} />
      </div>
      <Field label="Grade" htmlFor="section-grade" error={fe.gradeId}>
        <Select id="section-grade" name="gradeId" required className="w-48" defaultValue={grades[0]?.id ?? ""}>
          {grades.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Section" htmlFor="section-name" error={fe.name}>
        <Input id="section-name" name="name" placeholder="e.g. C" required className="w-24" />
      </Field>
      <Field label="Capacity" htmlFor="section-capacity" error={fe.capacity}>
        <Input id="section-capacity" name="capacity" type="number" min={1} placeholder="30" className="w-24" />
      </Field>
      <Button type="submit" disabled={pending || grades.length === 0} variant="secondary">
        {pending ? "Adding…" : "Add section"}
      </Button>
    </form>
  );
}
