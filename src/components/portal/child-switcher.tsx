import Link from "next/link";
import type { PortalScope } from "@/modules/portal/scope";

/**
 * A parent with more than one child needs to say which one. Rendered as
 * links rather than a select so it works without JavaScript and so each
 * child's view is a real, shareable URL — and the id in that URL is checked
 * against the scope on every read (see studentInScope), so editing it by
 * hand reaches nothing.
 */
export function ChildSwitcher({
  scope,
  students,
  activeId,
  basePath,
}: {
  scope: PortalScope;
  students: { id: string; firstName: string; lastName: string }[];
  activeId: string;
  basePath: string;
}) {
  if (scope.studentIds.length < 2) return null;
  return (
    <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Choose a child">
      {students.map((c) => {
        const active = c.id === activeId;
        return (
          <Link
            key={c.id}
            href={`${basePath}?child=${c.id}`}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "rounded-full bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "rounded-full border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
            }
          >
            {c.firstName}
          </Link>
        );
      })}
    </nav>
  );
}
