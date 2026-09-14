"use client";

import { useActionState } from "react";
import { authButtonClass, authInputClass } from "@/components/auth/auth-card";

/**
 * Choose a password, once — for an invitation or a reset. The action
 * redirects on success and returns a message otherwise.
 */
export function SetPasswordForm({
  action,
  submitLabel,
}: {
  action: (prev: string | undefined, formData: FormData) => Promise<string | undefined>;
  submitLabel: string;
}) {
  const [error, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          New password
        </label>
        <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" aria-describedby="password-hint" className={authInputClass} />
        <p id="password-hint" className="text-xs text-zinc-500 dark:text-zinc-400">
          At least 10 characters. A few unrelated words is easier to remember than a jumble, and harder to guess.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirm" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Type it again
        </label>
        <input id="confirm" name="confirm" type="password" required minLength={10} autoComplete="new-password" className={authInputClass} />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className={authButtonClass}>
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
