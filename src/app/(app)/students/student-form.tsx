"use client";

import { useActionState } from "react";
import { Button, ErrorBanner, Field, Input, Select, Textarea } from "@/components/ui";
import type { FormState } from "@/modules/sis/form-state";

export interface StudentFormValues {
  admissionNumber?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  bloodGroup?: string;
  medicalNotes?: string;
}

export function StudentForm({
  action,
  branchId,
  initial = {},
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  branchId: string;
  initial?: StudentFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const fe = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex max-w-3xl flex-col gap-6">
      <input type="hidden" name="branchId" value={branchId} />
      <ErrorBanner message={state?.error} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Admission number" htmlFor="admissionNumber" error={fe.admissionNumber}>
          <Input id="admissionNumber" name="admissionNumber" required defaultValue={initial.admissionNumber} />
        </Field>
        <Field label="Date of birth" htmlFor="dateOfBirth" error={fe.dateOfBirth} hint="yyyy-mm-dd">
          <Input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={initial.dateOfBirth} />
        </Field>
        <Field label="First name" htmlFor="firstName" error={fe.firstName}>
          <Input id="firstName" name="firstName" required defaultValue={initial.firstName} />
        </Field>
        <Field label="Last name" htmlFor="lastName" error={fe.lastName}>
          <Input id="lastName" name="lastName" required defaultValue={initial.lastName} />
        </Field>
        <Field label="Gender" htmlFor="gender" error={fe.gender}>
          <Select id="gender" name="gender" defaultValue={initial.gender ?? ""}>
            <option value="">—</option>
            <option value="F">Female</option>
            <option value="M">Male</option>
            <option value="Other">Other</option>
          </Select>
        </Field>
        <Field label="Blood group" htmlFor="bloodGroup" error={fe.bloodGroup}>
          <Input id="bloodGroup" name="bloodGroup" placeholder="e.g. O+" defaultValue={initial.bloodGroup} />
        </Field>
      </div>

      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Address</legend>
        <Field label="Address line 1" htmlFor="addressLine1" error={fe.addressLine1}>
          <Input id="addressLine1" name="addressLine1" defaultValue={initial.addressLine1} />
        </Field>
        <Field label="Address line 2" htmlFor="addressLine2" error={fe.addressLine2}>
          <Input id="addressLine2" name="addressLine2" defaultValue={initial.addressLine2} />
        </Field>
        <Field label="City" htmlFor="city" error={fe.city}>
          <Input id="city" name="city" defaultValue={initial.city} />
        </Field>
        <Field label="State" htmlFor="state" error={fe.state}>
          <Input id="state" name="state" defaultValue={initial.state} />
        </Field>
        <Field label="Postal code" htmlFor="postalCode" error={fe.postalCode}>
          <Input id="postalCode" name="postalCode" defaultValue={initial.postalCode} />
        </Field>
      </fieldset>

      <Field label="Medical notes" htmlFor="medicalNotes" error={fe.medicalNotes} hint="Allergies, conditions, medication — visible to staff with student access.">
        <Textarea id="medicalNotes" name="medicalNotes" rows={3} defaultValue={initial.medicalNotes} />
      </Field>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
