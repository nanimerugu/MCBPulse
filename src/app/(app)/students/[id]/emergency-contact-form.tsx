"use client";

import { useActionState } from "react";
import { Button, ErrorBanner, Field, Input, SuccessBanner } from "@/components/ui";
import type { FormState } from "@/modules/sis/form-state";

export function EmergencyContactForm({
  action,
  branchId,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  branchId: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const fe = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="branchId" value={branchId} />
      <ErrorBanner message={state?.error} />
      <SuccessBanner message={state?.success} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Name" htmlFor="ec-name" error={fe.name}>
          <Input id="ec-name" name="name" required />
        </Field>
        <Field label="Phone" htmlFor="ec-phone" error={fe.phone}>
          <Input id="ec-phone" name="phone" type="tel" required />
        </Field>
        <Field label="Relationship" htmlFor="ec-relationship" error={fe.relationship}>
          <Input id="ec-relationship" name="relationship" placeholder="e.g. Aunt, Neighbour" required />
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={pending} variant="secondary">
          {pending ? "Adding…" : "Add contact"}
        </Button>
      </div>
    </form>
  );
}
