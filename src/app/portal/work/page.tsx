import { Badge, Card, EmptyState } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import { ChildSwitcher } from "@/components/portal/child-switcher";
import { PortalDenied } from "@/components/portal/denial";
import { loadPortalPage } from "@/modules/portal/page-shell";
import { getAssignments } from "@/modules/portal/portal.service";
import { SUBMISSION_STATUS_LABELS } from "@/modules/lms/grading";
import { formatDate } from "@/modules/sis/labels";
import { param } from "@/modules/sis/access";
import type { SubmissionStatus } from "@/generated/prisma/enums";

const TONES: Record<SubmissionStatus, BadgeTone> = {
  PENDING: "neutral",
  SUBMITTED: "blue",
  LATE: "amber",
  GRADED: "green",
};

export default async function PortalWork({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const page = await loadPortalPage(param(sp, "child"));
  if (!page.ok) return <PortalDenied result={page.result} />;
  const { scope, studentId, children } = page;

  const assignments = await getAssignments(studentId, scope.organizationId);

  return (
    <div className="mx-auto max-w-2xl">
      <ChildSwitcher scope={scope} students={children} activeId={studentId} basePath="/portal/work" />
      <h1 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Work & marks</h1>

      {assignments === null ? (
        <EmptyState>Learning is not switched on at this school.</EmptyState>
      ) : assignments.length === 0 ? (
        <EmptyState>No published work yet.</EmptyState>
      ) : (
        <Card title={`${assignments.length} published assignment${assignments.length === 1 ? "" : "s"}`}>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {assignments.map((a) => (
              <li key={a.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">{a.title}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {a.subject ? `${a.subject} · ` : ""}due {formatDate(a.dueAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {a.marksAwarded !== null ? (
                      <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-50">
                        {a.marksAwarded}/{a.maxMarks}
                      </span>
                    ) : null}
                    <Badge tone={TONES[a.status]}>{SUBMISSION_STATUS_LABELS[a.status].toLowerCase()}</Badge>
                  </div>
                </div>
                {a.feedback ? <p className="mt-1.5 text-zinc-600 dark:text-zinc-300">{a.feedback}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-600">
        Work is submitted to the teacher, not through this page — online submission is not built yet.
      </p>
    </div>
  );
}
