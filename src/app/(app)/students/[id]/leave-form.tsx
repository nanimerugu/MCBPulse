"use client";

import { useActionState } from "react";
import { Button, ErrorBanner, Field, Input, SuccessBanner } from "@/components/ui";
import type { FormState } from "@/modules/sis/form-state";

export function LeaveForm({ action, branchId }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; branchId: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="branchId" value={branchId} />
      <ErrorBanner message={state?.error} />
      <SuccessBanner message={state?.success} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="From" htmlFor="leave-from" error={fe.fromDate}>
          <Input id="leave-from" name="fromDate" type="date" required />
        </Field>
        <Field label="To" htmlFor="leave-to" error={fe.toDate}>
          <Input id="leave-to" name="toDate" type="date" required />
        </Field>
        <Field label="Reason" htmlFor="leave-reason" error={fe.reason}>
          <Input id="leave-reason" name="reason" placeholder="e.g. Family wedding" required />
        </Field>
      </div>
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Record leave"}
        </Button>
      </div>
    </form>
  );
}
