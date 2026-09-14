"use client";

import { useActionState } from "react";
import { Button, ErrorBanner, Field, Input, Select, SuccessBanner } from "@/components/ui";
import type { FormState } from "@/modules/sis/form-state";

export interface ExistingGuardianOption {
  id: string;
  label: string; // "Anil Rao · 9000000001 · guardian of Priya Rao (N-1001)"
}

export function GuardianForm({
  action,
  branchId,
  existing,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  branchId: string;
  /** Guardians of other students in this org — offered for sibling linking. */
  existing: ExistingGuardianOption[];
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const fe = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="branchId" value={branchId} />
      <ErrorBanner message={state?.error} />
      <SuccessBanner message={state?.success} />

      {existing.length > 0 ? (
        <Field label="Link an existing guardian (siblings)" htmlFor="existingGuardianId" hint="Leave blank to add a new person below.">
          <Select id="existingGuardianId" name="existingGuardianId" defaultValue="">
            <option value="">— new guardian —</option>
            {existing.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="First name" htmlFor="g-firstName" error={fe.firstName}>
          <Input id="g-firstName" name="firstName" />
        </Field>
        <Field label="Last name" htmlFor="g-lastName" error={fe.lastName}>
          <Input id="g-lastName" name="lastName" />
        </Field>
        <Field label="Phone" htmlFor="g-phone" error={fe.phone}>
          <Input id="g-phone" name="phone" type="tel" />
        </Field>
        <Field label="Email" htmlFor="g-email" error={fe.email}>
          <Input id="g-email" name="email" type="email" />
        </Field>
        <Field label="Occupation" htmlFor="g-occupation" error={fe.occupation}>
          <Input id="g-occupation" name="occupation" />
        </Field>
        <Field label="Relationship" htmlFor="g-relationship" error={fe.relationship}>
          <Select id="g-relationship" name="relationship" defaultValue="MOTHER">
            <option value="MOTHER">Mother</option>
            <option value="FATHER">Father</option>
            <option value="GUARDIAN">Guardian</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input type="checkbox" name="isPrimary" className="h-4 w-4" />
        Primary contact
      </label>
      <div>
        <Button type="submit" disabled={pending} variant="secondary">
          {pending ? "Linking…" : "Link guardian"}
        </Button>
      </div>
    </form>
  );
}
