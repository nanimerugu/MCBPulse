import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { Providers } from "@/components/providers";
import { getPortalScope } from "@/modules/portal/scope";

/**
 * The portal has its OWN shell, deliberately not the staff AppShell.
 *
 * The staff shell is a 240px sidebar listing every module, with a branch
 * picker — the wrong shape on a phone and the wrong idea entirely for a
 * parent. This one is mobile-first (a bottom bar on small screens, a top bar
 * above them), lists only what this viewer has, and has no branch picker at
 * all: a portal viewer's branch is whatever their child's is.
 *
 * It also keeps the two surfaces from leaking into each other. There is no
 * link from here into /students or /finance, and the staff gate refuses a
 * self-scoped grant anyway, so neither reachability nor authorization
 * depends on the other being right.
 */

const PARENT_TABS = [
  { href: "/portal", label: "Home" },
  { href: "/portal/attendance", label: "Attendance" },
  { href: "/portal/work", label: "Work" },
  { href: "/portal/fees", label: "Fees" },
  { href: "/portal/reports", label: "Reports" },
  { href: "/portal/notices", label: "Notices" },
];

const STUDENT_TABS = PARENT_TABS.filter((t) => t.href !== "/portal/fees");
const DRIVER_TABS = [{ href: "/portal", label: "Manifest" }];

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const result = await getPortalScope();
  const tabs = !result.ok ? [] : result.scope.kind === "driver" ? DRIVER_TABS : result.scope.kind === "student" ? STUDENT_TABS : PARENT_TABS;
  const who = result.ok ? result.scope.viewer.name : "";

  return (
    <Providers>
      <div className="flex min-h-screen flex-col bg-white dark:bg-zinc-950">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-zinc-900 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white dark:focus:bg-zinc-100 dark:focus:text-zinc-900"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950">
          <Link href="/portal" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            MCBPulse
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-zinc-600 sm:inline dark:text-zinc-300">{who}</span>
            <SignOutButton />
          </div>
        </header>

        {tabs.length > 1 ? (
          <nav aria-label="Sections" className="hidden border-b border-zinc-200 px-4 sm:block dark:border-zinc-800">
            <ul className="flex gap-1">
              {tabs.map((t) => (
                <li key={t.href}>
                  <Link
                    href={t.href}
                    className="inline-block px-3 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                  >
                    {t.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        {/* pb-20 leaves room for the bottom bar on small screens. */}
        <main id="main" className="flex-1 px-4 pb-20 pt-4 sm:pb-6">{children}</main>

        {tabs.length > 1 ? (
          <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-white sm:hidden dark:border-zinc-800 dark:bg-zinc-950">
            <ul className="flex">
              {tabs.map((t) => (
                <li key={t.href} className="flex-1">
                  <Link href={t.href} className="flex h-14 items-center justify-center text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    {t.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </Providers>
  );
}
