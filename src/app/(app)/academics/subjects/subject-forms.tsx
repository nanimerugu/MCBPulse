"use client";

import { useActionState } from "react";
import { Button, ErrorBanner, Field, Input, Select, SuccessBanner } from "@/components/ui";
import type { FormState } from "@/modules/sis/form-state";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function SubjectForm({ action, branchId }: { action: Action; branchId: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="branchId" value={branchId} />
      <div className="w-full">
        <ErrorBanner message={state?.error} />
        <SuccessBanner message={state?.success} />
      </div>
      <Field label="Subject name" htmlFor="subject-name" error={fe.name}>
        <Input id="subject-name" name="name" placeholder="e.g. Physics" required className="w-56" />
      </Field>
      <Field label="Code" htmlFor="subject-code" error={fe.code}>
        <Input id="subject-code" name="code" placeholder="PHY" required className="w-28 uppercase" />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Adding…" : "Add subject"}
      </Button>
    </form>
  );
}

const CURRICULUM_TYPES = [
  ["CBSE", "CBSE"],
  ["STATE_BOARD", "State board"],
  ["IB", "IB"],
  ["CAMBRIDGE", "Cambridge"],
  ["MONTESSORI", "Montessori"],
  ["PRESCHOOL", "Preschool"],
  ["HIGHER_ED", "Higher education"],
] as const;

export function CurriculumForm({ action, branchId }: { action: Action; branchId: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="branchId" value={branchId} />
      <div className="w-full">
        <ErrorBanner message={state?.error} />
        <SuccessBanner message={state?.success} />
      </div>
      <Field label="Curriculum name" htmlFor="curriculum-name" error={fe.name}>
        <Input id="curriculum-name" name="name" placeholder="e.g. CBSE 2026" required className="w-56" />
      </Field>
      <Field label="Type" htmlFor="curriculum-type" error={fe.type}>
        <Select id="curriculum-type" name="type" defaultValue="CBSE" className="w-44">
          {CURRICULUM_TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Adding…" : "Add curriculum"}
      </Button>
    </form>
  );
}
