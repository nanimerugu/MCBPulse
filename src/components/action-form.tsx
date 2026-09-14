"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import { Button, ErrorBanner, SuccessBanner } from "@/components/ui";
import type { FormState } from "@/modules/sis/form-state";

/**
 * A server-action form whose fields are supplied as children by the (server)
 * page. Keeps a page from needing one client component per small form:
 * hidden context travels in `hidden`, the state banner and field errors
 * render here, the inputs themselves stay plain and server-rendered.
 */
export function ActionForm({
  action,
  hidden,
  submitLabel,
  pendingLabel,
  variant = "secondary",
  className,
  inline = false,
  children,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  hidden: Record<string, string>;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
  /** Lay the fields and button out in one row. */
  inline?: boolean;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const fieldErrors = Object.entries(state?.fieldErrors ?? {});

  return (
    <form action={formAction} className={className ?? (inline ? "flex flex-wrap items-end gap-2" : "flex flex-col gap-3")}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {state?.error || state?.success || fieldErrors.length > 0 ? (
        <div className="w-full">
          <ErrorBanner message={state?.error} />
          <SuccessBanner message={state?.success} />
          {fieldErrors.length > 0 ? (
            <ul role="alert" className="mt-1 list-disc pl-5 text-xs text-red-600 dark:text-red-400">
              {fieldErrors.map(([field, message]) => (
                <li key={field}>
                  <span className="font-mono">{field}</span>: {message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {children}
      <div>
        <Button type="submit" variant={variant} disabled={pending} className={inline ? "!py-2" : undefined}>
          {pending ? (pendingLabel ?? "Saving…") : submitLabel}
        </Button>
      </div>
    </form>
  );
}
