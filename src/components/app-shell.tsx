import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * The global navigation from the blueprint's information architecture
 * (docs/architecture-blueprint-raw.md, section 23). An item is live only
 * when three things hold: its phase has shipped, its feature flag is on for
 * this organization, and the viewer holds the permission that opens it.
 * Everything else is a disabled placeholder labelled by the phase that
 * builds it — visible so the shape of the product is clear, disabled so
 * nobody mistakes it for working.
 */
interface NavItem {
  label: string;
  href?: string;
  comingInPhase?: string;
  /** Feature-flag key gating a shipped item. */
  flag?: string;
  /** Permission that opens it; without this the item is hidden entirely. */
  permission?: string;
}

const NAV_SECTIONS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Students", href: "/students", flag: "phase1.sis", permission: "sis.students:view" },
  { label: "Staff", href: "/staff", flag: "phase1.sis", permission: "sis.staff:view" },
  { label: "Academics", href: "/academics", flag: "phase2.academics", permission: "academics.timetable:view" },
  { label: "Admissions", href: "/admissions", flag: "phase3.admissions", permission: "admissions.leads:view" },
  { label: "Finance", href: "/finance", flag: "phase4.finance", permission: "finance.invoices:view" },
  { label: "LMS", href: "/lms", flag: "phase5.lms", permission: "lms.assignments:view" },
  { label: "Communication", href: "/connect", flag: "phase6.connect", permission: "connect.broadcasts:view" },
  { label: "HR", comingInPhase: "Phase 7" },
  { label: "Operations", comingInPhase: "Phase 8" },
  { label: "Reports & Analytics", comingInPhase: "Phase 11" },
  { label: "AI Copilot", comingInPhase: "Phase 10" },
];

export function AppShell({
  children,
  organizationName,
  userName,
  enabledFlags,
  permissions,
}: {
  children: React.ReactNode;
  organizationName: string | null;
  userName: string;
  enabledFlags: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
}) {
  return (
    <div className="flex min-h-screen flex-1">
      <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 px-4 py-4 dark:border-zinc-800">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">MCBPulse</p>
          <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">{organizationName ?? "No organization"}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {NAV_SECTIONS.map((item) => {
            const flagOn = !item.flag || enabledFlags.has(item.flag);
            const permitted = !item.permission || permissions.has(item.permission);
            // Shipped, switched on, but not for this person: say nothing at all.
            if (item.href && flagOn && !permitted) return null;

            if (item.href && flagOn) {
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200/60 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {item.label}
                </Link>
              );
            }

            const tag = item.flag ? "Off" : item.comingInPhase;
            const title = item.flag ? `Feature flag ${item.flag} is off for this organization` : `Arrives in ${item.comingInPhase}`;
            return (
              <div
                key={item.label}
                className="flex cursor-not-allowed items-center justify-between rounded-md px-3 py-2 text-sm text-zinc-400 dark:text-zinc-600"
                title={title}
              >
                <span>{item.label}</span>
                <span className="rounded bg-zinc-200/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500">
                  {tag}
                </span>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
          <Link
            href="/settings"
            className="block rounded-md px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200/60 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Settings
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-end gap-4 border-b border-zinc-200 px-6 dark:border-zinc-800">
          <span className="text-sm text-zinc-600 dark:text-zinc-300">{userName}</span>
          <SignOutButton />
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
