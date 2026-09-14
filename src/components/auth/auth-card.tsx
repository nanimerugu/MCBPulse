import type { ReactNode } from "react";

/** The centred card every signed-out page uses — sign in, set a password, reset one. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <main id="main" className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">MCBPulse</p>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p> : null}
        </div>
        {children}
      </div>
    </main>
  );
}

export const authInputClass =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100";

export const authButtonClass =
  "mt-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";
