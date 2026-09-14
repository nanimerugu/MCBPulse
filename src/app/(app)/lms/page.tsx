import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadLmsAccess, param } from "@/modules/sis/access";
import { getSectionScope } from "@/modules/academics/scope";
import { listAssignments, listUpcoming } from "@/modules/lms/assignments.service";
import { formatDate } from "@/modules/sis/labels";

export default async function LmsIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadLmsAccess(param(sp, "branch"), "lms.assignments", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Learning" />
        <AccessDenied result={result} permission="lms.assignments:view" />
      </>
    );
  }
  const { ctx } = result.access;
  const scope = await getSectionScope(result.access);
  const [due, recent] = await Promise.all([
    listUpcoming({ organizationId: ctx.organizationId, branchId: ctx.branch.id, sectionIds: scope.sectionIds }),
    listAssignments({ organizationId: ctx.organizationId, branchId: ctx.branch.id, sectionIds: scope.sectionIds, includeDrafts: true }),
  ]);
  const drafts = recent.filter((a) => !a.publishedAt);

  const cards = [
    { href: "/lms/courses", title: "Courses", description: "Course catalog with modules and lessons — shared across every section that teaches it." },
    { href: "/lms/assignments", title: "Assignments", description: "Set work for a section, publish it, then grade the roster." },
    { href: "/lms/gradebook", title: "Gradebook", description: "Every published assignment for a section, per student, with a running percentage." },
  ];

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Learning"
        description={
          <>
            {ctx.branch.name}
            {ctx.academicYear ? ` · ${ctx.academicYear.name}` : ""}
            {scope.sectionIds !== null ? " · showing only your assigned sections" : ""}
          </>
        }
      />

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <li key={c.href}>
            <Link href={withBranch(c.href, ctx)} className="block h-full rounded-lg border border-zinc-200 p-4 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
              <p className="font-medium text-zinc-900 dark:text-zinc-50">{c.title}</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{c.description}</p>
            </Link>
          </li>
        ))}
      </ul>

      <Card title="Due next">
        {due.length === 0 ? (
          <EmptyState>Nothing published and upcoming.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {due.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <Link href={withBranch(`/lms/assignments/${a.id}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                  {a.title}
                </Link>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {a.section ? `${a.section.grade.name} / ${a.section.name}` : "—"} · due {formatDate(a.dueAt)} · {a._count.submissions} recorded
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {drafts.length > 0 ? (
        <Card title={`Drafts (${drafts.length})`}>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {drafts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <Link href={withBranch(`/lms/assignments/${a.id}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                  {a.title}
                </Link>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {a.section ? `${a.section.grade.name} / ${a.section.name}` : "—"} · not published · due {formatDate(a.dueAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
