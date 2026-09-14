"use client";

import { useActionState } from "react";
import { Button, ErrorBanner, Field, Input, Select } from "@/components/ui";
import type { FormState } from "@/modules/sis/form-state";

export function StaffForm({
  action,
  branchId,
  roles,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  branchId: string;
  roles: { key: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const fe = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4">
      <input type="hidden" name="branchId" value={branchId} />
      <ErrorBanner message={state?.error} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="name" error={fe.name}>
          <Input id="name" name="name" required />
        </Field>
        <Field label="Email (login)" htmlFor="email" error={fe.email}>
          <Input id="email" name="email" type="email" required />
        </Field>
        <Field label="Employee code" htmlFor="employeeCode" error={fe.employeeCode}>
          <Input id="employeeCode" name="employeeCode" required />
        </Field>
        <Field label="Designation" htmlFor="designation" error={fe.designation}>
          <Input id="designation" name="designation" placeholder="e.g. Mathematics Teacher" required />
        </Field>
        <Field label="Join date" htmlFor="joinDate" error={fe.joinDate}>
          <Input id="joinDate" name="joinDate" type="date" required />
        </Field>
        <Field label="Role in this branch" htmlFor="roleKey" error={fe.roleKey}>
          <Select id="roleKey" name="roleKey" required defaultValue="teacher">
            {roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field
        label="Initial password (optional)"
        htmlFor="initialPassword"
        error={fe.initialPassword}
        hint="Interim until invite emails exist (Phase 6). Blank = login created but not yet usable."
      >
        <Input id="initialPassword" name="initialPassword" type="password" autoComplete="new-password" minLength={10} />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create staff member"}
        </Button>
      </div>
    </form>
  );
}
