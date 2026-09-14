import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadLmsAccess, param } from "@/modules/sis/access";
import { getSectionScope, sectionInScope } from "@/modules/academics/scope";
import { listEnrollableSections } from "@/modules/sis/students.service";
import { getGradebook } from "@/modules/lms/assignments.service";
import { formatPercentage } from "@/modules/lms/grading";

export default async function GradebookPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadLmsAccess(param(sp, "branch"), "lms.grades", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Gradebook" />
        <AccessDenied result={result} permission="lms.grades:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const scope = await getSectionScope(result.access);

  const allSections = await listEnrollableSections(ctx.branch.id);
  const sections = allSections.filter((s) => sectionInScope(scope, s.id));
  const requested = param(sp, "section");
  const section = sections.find((s) => s.id === requested) ?? sections[0];

  const [book, canExport] = section
    ? await Promise.all([getGradebook(section.id, ctx.organizationId), authorize(viewer.userId, "lms.grades", "export", { organizationId: ctx.organizationId, branchId: ctx.branch.id })])
    : [null, false];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Gradebook"
        description={section ? `${section.grade.name} / ${section.name} · published assignments only` : ctx.branch.name}
        actions={
          <>
            <LinkButton href={withBranch("/lms", ctx)}>← Learning</LinkButton>
            {canExport && section ? <LinkButton href={withBranch(`/lms/gradebook/export?section=${section.id}`, ctx)}>Export CSV</LinkButton> : null}
          </>
        }
      />

      {sections.length === 0 ? (
        <EmptyState>{scope.sectionIds !== null ? "You aren't assigned to any section yet." : "No sections in the current academic year."}</EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-zinc-500 dark:text-zinc-400">Section:</span>
            {sections.map((s) => (
              <Link
                key={s.id}
                href={withBranch(`/lms/gradebook?section=${s.id}`, ctx)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${s.id === section?.id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}
              >
                {s.grade.name} / {s.name}
              </Link>
            ))}
          </div>

          {!book || book.assignments.length === 0 ? (
            <EmptyState>No published assignments for this section yet.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                  <tr>
                    <th className="sticky left-0 bg-zinc-50 px-3 py-2 font-medium dark:bg-zinc-950">Student</th>
                    {book.assignments.map((a) => (
                      <th key={a.id} className="px-3 py-2 text-right font-medium" title={a.title}>
                        <span className="block max-w-28 truncate">{a.title}</span>
                        <span className="font-normal text-zinc-400">/{a.maxMarks}</span>
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right font-medium">Average</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {book.rows.map((r) => (
                    <tr key={r.studentId} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                      <td className="sticky left-0 bg-white px-3 py-1.5 dark:bg-zinc-900">
                        <Link href={withBranch(`/students/${r.studentId}`, ctx)} className="text-zinc-900 hover:underline dark:text-zinc-50">
                          {r.name}
                        </Link>{" "}
                        <span className="font-mono text-xs text-zinc-500">{r.admissionNumber}</span>
                      </td>
                      {r.cells.map((c) => (
                        <td key={c.assignmentId} className="px-3 py-1.5 text-right font-mono text-xs">
                          {c.marksAwarded !== null ? (
                            c.marksAwarded
                          ) : c.status === "PENDING" ? (
                            <span className="text-zinc-300 dark:text-zinc-600">—</span>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400" title="Submitted, not yet graded">
                              ·
                            </span>
                          )}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-right font-mono text-xs font-semibold">{formatPercentage(r.totals.percentage)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            The average counts graded work only, so an assignment nobody has marked yet doesn&apos;t drag the class down mid-term. A dot means submitted but
            ungraded; a dash means nothing recorded.
          </p>
        </>
      )}
    </div>
  );
}
