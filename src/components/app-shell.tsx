import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { OPS_LANDING_PERMISSION_KEYS } from "@/modules/operations/nav";

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
  /**
   * Permission(s) that open it; without one the item is hidden entirely.
   * A list means ANY of them is enough — Operations is six sub-modules with
   * separate permissions, and a hostel warden holding only `ops.hostel` must
   * still see the section that contains their work.
   */
  permission?: string | readonly string[];
}

function permits(item: NavItem, held: ReadonlySet<string>): boolean {
  if (!item.permission) return true;
  const keys = typeof item.permission === "string" ? [item.permission] : item.permission;
  return keys.some((k) => held.has(k));
}

const NAV_SECTIONS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  // No permission: this page resolves the viewer's OWN staff record and
  // can only ever show their own leave and payslips.
  { label: "My leave", href: "/my/leave", flag: "phase7.hr" },
  { label: "Students", href: "/students", flag: "phase1.sis", permission: "sis.students:view" },
  { label: "Staff", href: "/staff", flag: "phase1.sis", permission: "sis.staff:view" },
  { label: "Academics", href: "/academics", flag: "phase2.academics", permission: "academics.timetable:view" },
  { label: "Admissions", href: "/admissions", flag: "phase3.admissions", permission: "admissions.leads:view" },
  { label: "Finance", href: "/finance", flag: "phase4.finance", permission: "finance.invoices:view" },
  { label: "LMS", href: "/lms", flag: "phase5.lms", permission: "lms.assignments:view" },
  { label: "Exams", href: "/exams", flag: "exams.examcell", permission: ["exams.exams:view", "exams.banks:view"] },
  { label: "Communication", href: "/connect", flag: "phase6.connect", permission: "connect.broadcasts:view" },
  { label: "HR", href: "/hr", flag: "phase7.hr", permission: "hr.org:view" },
  { label: "Operations", href: "/operations", flag: "phase8.operations", permission: OPS_LANDING_PERMISSION_KEYS },
  { label: "Report cards", href: "/reports", flag: "reporting.cards", permission: "reporting.cards:view" },
  { label: "Files", href: "/files", flag: "files.storage", permission: "files.assets:view" },
  { label: "Reports & Analytics", href: "/analytics", flag: "phase11.analytics", permission: "analytics.dashboard:view" },
  { label: "Automation", href: "/automation", flag: "automation.rules", permission: "automation.rules:view" },
  { label: "AI Copilot", href: "/ai", flag: "ai.copilot", permission: "ai.console:view" },
];

/**
 * Every flag the nav needs resolved, derived from the items themselves. The
 * layout used to keep its own hand-written copy of this list, and Phase 7
 * shipped with HR invisible because the new key was added in one place and
 * not the other. Deriving it means adding a nav item is the whole change.
 */
export const NAV_FLAGS: readonly string[] = [...new Set(NAV_SECTIONS.flatMap((i) => (i.flag ? [i.flag] : [])))];

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
      {/*
        A keyboard user should not have to tab through every nav item on
        every page to reach the content. The link is visually hidden until
        focused, which is the only state in which it is useful.
      */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-zinc-900 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white dark:focus:bg-zinc-100 dark:focus:text-zinc-900"
      >
        Skip to content
      </a>
      {/*
        The sidebar is a drawer below `sm` and a fixed column above it. It is
        a <details> rather than client state on purpose: the shell is a server
        component, and a disclosure element gives a working menu with no
        hydration, no JavaScript and correct keyboard behaviour for free.
      */}
      <details className="group fixed inset-x-0 top-0 z-20 border-b border-zinc-200 bg-zinc-50 sm:hidden dark:border-zinc-800 dark:bg-zinc-950">
        <summary className="flex h-14 cursor-pointer list-none items-center justify-between px-4 [&::-webkit-details-marker]:hidden">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">MCBPulse</span>
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 group-open:hidden">Menu</span>
          <span className="hidden text-xs font-medium uppercase tracking-wide text-zinc-500 group-open:inline">Close</span>
        </summary>
        <nav aria-label="Main" className="flex flex-col gap-0.5 border-t border-zinc-200 p-2 dark:border-zinc-800">
          {NAV_SECTIONS.map((item) => {
            const flagOn = !item.flag || enabledFlags.has(item.flag);
            if (!item.href || !flagOn || !permits(item, permissions)) return null;
            return (
              <Link key={item.label} href={item.href} className="rounded-md px-3 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                {item.label}
              </Link>
            );
          })}
          <Link href="/settings" className="rounded-md px-3 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-200">
            Settings
          </Link>
        </nav>
      </details>

      <aside className="hidden w-60 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 sm:flex dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 px-4 py-4 dark:border-zinc-800">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">MCBPulse</p>
          <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">{organizationName ?? "No organization"}</p>
        </div>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {NAV_SECTIONS.map((item) => {
            const flagOn = !item.flag || enabledFlags.has(item.flag);
            const permitted = permits(item, permissions);
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
        {/* pt-14 on small screens clears the fixed drawer header above. */}
        <header className="mt-14 flex h-14 shrink-0 items-center justify-end gap-4 border-b border-zinc-200 px-4 sm:mt-0 sm:px-6 dark:border-zinc-800">
          <span className="truncate text-sm text-zinc-600 dark:text-zinc-300">{userName}</span>
          <SignOutButton />
        </header>
        <main id="main" className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
