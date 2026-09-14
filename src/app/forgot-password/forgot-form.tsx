"use client";

import { useActionState } from "react";
import { authButtonClass, authInputClass } from "@/components/auth/auth-card";
import { requestResetAction } from "@/app/forgot-password/actions";

export function ForgotForm() {
  const [state, formAction, pending] = useActionState(requestResetAction, undefined);

  if (state?.sent) {
    return (
      <div role="status" className="flex flex-col gap-3 text-sm text-zinc-700 dark:text-zinc-200">
        <p>If an account uses that address, we&apos;ve emailed it a link to choose a new password. The link works once, for an hour.</p>
        <p className="text-zinc-500 dark:text-zinc-400">
          Nothing arrived after a few minutes? Check spam, then ask the school office — they can send the link again.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Email
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={authInputClass} />
      </div>
      {state?.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={authButtonClass}>
        {pending ? "Sending…" : "Send me a link"}
      </button>
    </form>
  );
}
