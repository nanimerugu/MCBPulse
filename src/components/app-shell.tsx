import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * The global navigation from the blueprint's information architecture
 * (docs/architecture-blueprint-raw.md, section 23). Everything past
 * Dashboard and Settings is a placeholder for a phase that hasn't landed
 * yet — shown so the shape of the product is visible, disabled so nobody
 * mistakes it for working.
 */
const NAV_SECTIONS: { label: string; href?: string; comingInPhase?: string }[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Students", comingInPhase: "Phase 1" },
  { label: "Academics", comingInPhase: "Phase 2" },
  { label: "Admissions", comingInPhase: "Phase 3" },
  { label: "Finance", comingInPhase: "Phase 4" },
  { label: "LMS", comingInPhase: "Phase 5" },
  { label: "Communication", comingInPhase: "Phase 6" },
  { label: "HR", comingInPhase: "Phase 7" },
  { label: "Operations", comingInPhase: "Phase 8" },
  { label: "Reports & Analytics", comingInPhase: "Phase 11" },
  { label: "AI Copilot", comingInPhase: "Phase 10" },
];

export function AppShell({
  children,
  organizationName,
  userName,
}: {
  children: React.ReactNode;
  organizationName: string | null;
  userName: string;
}) {
  return (
    <div className="flex min-h-screen flex-1">
      <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 px-4 py-4 dark:border-zinc-800">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">MCBPulse</p>
          <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
            {organizationName ?? "No organization"}
          </p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {NAV_SECTIONS.map((item) =>
            item.href ? (
              <Link
                key={item.label}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200/60 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {item.label}
              </Link>
            ) : (
              <div
                key={item.label}
                className="flex cursor-not-allowed items-center justify-between rounded-md px-3 py-2 text-sm text-zinc-400 dark:text-zinc-600"
                title={`Arrives in ${item.comingInPhase}`}
              >
                <span>{item.label}</span>
                <span className="rounded bg-zinc-200/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500">
                  {item.comingInPhase}
                </span>
              </div>
            ),
          )}
        </nav>
        <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
          <Link
            href="/settings/users"
            className="block rounded-md px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200/60 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Settings
          </Link>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-end gap-4 border-b border-zinc-200 px-6 dark:border-zinc-800">
          <span className="text-sm text-zinc-600 dark:text-zinc-300">{userName}</span>
          <SignOutButton />
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
