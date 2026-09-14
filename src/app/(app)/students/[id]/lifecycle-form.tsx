"use client";

import { useActionState, useState } from "react";
import { Button, ErrorBanner, Field, Input, Select, SuccessBanner } from "@/components/ui";
import type { FormState } from "@/modules/sis/form-state";
import { ACTIONS_REQUIRING_SECTION, LIFECYCLE_LABELS, type LifecycleAction } from "@/modules/sis/lifecycle";

export function LifecycleForm({
  action,
  branchId,
  allowed,
  sections,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  branchId: string;
  allowed: LifecycleAction[];
  sections: { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [chosen, setChosen] = useState<LifecycleAction | "">(allowed[0] ?? "");
  const needsSection = chosen !== "" && ACTIONS_REQUIRING_SECTION.has(chosen);

  if (allowed.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">No further transitions — this record is terminal.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="branchId" value={branchId} />
      <ErrorBanner message={state?.error} />
      <SuccessBanner message={state?.success} />
      <Field label="Action" htmlFor="lifecycle-action">
        <Select id="lifecycle-action" name="action" value={chosen} onChange={(e) => setChosen(e.target.value as LifecycleAction)}>
          {allowed.map((a) => (
            <option key={a} value={a}>
              {LIFECYCLE_LABELS[a]}
            </option>
          ))}
        </Select>
      </Field>
      {needsSection ? (
        <Field label="Section" htmlFor="lifecycle-section" hint="Current academic year only">
          <Select id="lifecycle-section" name="sectionId" required defaultValue="">
            <option value="" disabled>
              Choose a section…
            </option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Note (optional)" htmlFor="lifecycle-note">
        <Input id="lifecycle-note" name="note" placeholder="Recorded in the timeline" />
      </Field>
      <div>
        <Button type="submit" disabled={pending || (needsSection && sections.length === 0)}>
          {pending ? "Applying…" : "Apply"}
        </Button>
      </div>
    </form>
  );
}
