import { Card, EmptyState } from "@/components/ui";
import { ChildSwitcher } from "@/components/portal/child-switcher";
import { PortalDenied } from "@/components/portal/denial";
import { loadPortalPage } from "@/modules/portal/page-shell";
import { listPublishedForStudent } from "@/modules/reporting/report-cards.service";
import { describeWeights, weightsOf } from "@/modules/reporting/weighting";
import { formatDate } from "@/modules/sis/labels";
import { param } from "@/modules/sis/access";

export default async function PortalReports({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const page = await loadPortalPage(param(sp, "child"));
  if (!page.ok) return <PortalDenied result={page.result} />;
  const { scope, studentId, children } = page;

  // Published only. A draft is a teacher's working copy, and a family seeing
  // marks that are still being changed is worse than seeing nothing yet.
  const cards = await listPublishedForStudent(studentId, scope.organizationId);

  return (
    <div className="mx-auto max-w-2xl">
      <ChildSwitcher scope={scope} students={children} activeId={studentId} basePath="/portal/reports" />
      <h1 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Report cards</h1>

      {cards.length === 0 ? (
        <EmptyState>No report has been published yet.</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {cards.map((c) => (
            <Card key={c.id} title={`${c.term} · ${c.academicYear.name}`}>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Subject</th>
                    <th className="py-2 pr-4 text-right font-medium">%</th>
                    <th className="py-2 text-right font-medium">Grade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {c.lines.map((l) => (
                    <tr key={l.id} className="align-top">
                      <td className="py-2 pr-4 text-zinc-900 dark:text-zinc-50">
                        {l.subjectName}
                        {l.basisNote ? <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">{l.basisNote}</p> : null}
                        {l.comment ? <p className="mt-1 text-xs italic text-zinc-600 dark:text-zinc-300">“{l.comment}”</p> : null}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{l.percent ?? "—"}</td>
                      <td className="py-2 text-right font-medium text-zinc-900 dark:text-zinc-50">{l.band ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-zinc-300 dark:border-zinc-700">
                  <tr>
                    <td className="py-2 pr-4 font-medium text-zinc-900 dark:text-zinc-50">Overall</td>
                    <td className="py-2 pr-4 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{c.overallPercent ?? "—"}</td>
                    <td className="py-2 text-right font-semibold text-zinc-900 dark:text-zinc-50">{c.overallBand ?? "—"}</td>
                  </tr>
                </tfoot>
              </table>

              {c.attendancePercent !== null ? (
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">Attendance: {c.attendancePercent}%</p>
              ) : null}
              {c.remarks ? <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">{c.remarks}</p> : null}
              <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                {describeWeights(weightsOf(c))} · published {formatDate(c.publishedAt ?? c.generatedAt)}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
