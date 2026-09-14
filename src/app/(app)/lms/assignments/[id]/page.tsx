import { notFound } from "next/navigation";
import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { Badge, Button, Card, DescriptionList, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadLmsAccess, param } from "@/modules/sis/access";
import { getSectionScope, sectionInScope } from "@/modules/academics/scope";
import { getAssignmentRoster } from "@/modules/lms/assignments.service";
import { formatPercentage, summarizeRow } from "@/modules/lms/grading";
import { formatDate } from "@/modules/sis/labels";
import { deleteAssignmentAction, publishAssignmentAction, saveGradesAction } from "@/app/(app)/lms/actions";
import { GradingForm } from "@/app/(app)/lms/assignments/[id]/grading-form";

export default async function AssignmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const result = await loadLmsAccess(param(sp, "branch"), "lms.assignments", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Assignment" />
        <AccessDenied result={result} permission="lms.assignments:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const tenant = { organizationId: ctx.organizationId, branchId: ctx.branch.id };

  const data = await getAssignmentRoster(id, ctx.organizationId);
  if (!data) notFound();
  const { assignment, rows } = data;

  // Attribute policy: a teacher only reaches work set for their own sections.
  const scope = await getSectionScope(result.access);
  if (!sectionInScope(scope, assignment.sectionId)) {
    return (
      <>
        <PageHeader title="Assignment" />
        <EmptyState>This assignment is for a section you aren&apos;t assigned to.</EmptyState>
      </>
    );
  }

  const [canPublish, canGrade, canEdit] = await Promise.all([
    authorize(viewer.userId, "lms.assignments", "publish", tenant),
    authorize(viewer.userId, "lms.grades", "edit", tenant),
    authorize(viewer.userId, "lms.assignments", "edit", tenant),
  ]);

  const published = Boolean(assignment.publishedAt);
  const totals = summarizeRow(rows.map((r) => ({ marksAwarded: r.marksAwarded, maxMarks: assignment.maxMarks, status: r.marksAwarded !== null ? "GRADED" : r.submittedAt ? "SUBMITTED" : "PENDING" })));
  const hidden = { branchId: ctx.branch.id };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={assignment.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {published ? <Badge tone="green">Published</Badge> : <Badge tone="neutral">Draft</Badge>}
            <span>{assignment.course.title}</span>
            <span>· {assignment.section ? `${assignment.section.grade.name} / ${assignment.section.name}` : "no section"}</span>
            <span>· due {formatDate(assignment.dueAt)}</span>
            <span>· out of {assignment.maxMarks}</span>
            {assignment.createdByStaff ? <span>· set by {assignment.createdByStaff.user.name}</span> : null}
          </span>
        }
        actions={<LinkButton href={withBranch("/lms/assignments", ctx)}>← Assignments</LinkButton>}
      />

      {assignment.instructions ? <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">{assignment.instructions}</p> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="lg:col-span-3">
          <Card title={`Roster (${rows.length})`}>
            {rows.length === 0 ? (
              <EmptyState>No enrolled students in this section.</EmptyState>
            ) : !published ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Publish the assignment to start recording submissions and marks.</p>
                <GradingForm
                  action={saveGradesAction.bind(null, assignment.id)}
                  branchId={ctx.branch.id}
                  sectionId={assignment.sectionId ?? ""}
                  rows={rows}
                  maxMarks={assignment.maxMarks}
                  editable={false}
                />
              </div>
            ) : (
              <GradingForm
                action={saveGradesAction.bind(null, assignment.id)}
                branchId={ctx.branch.id}
                sectionId={assignment.sectionId ?? ""}
                rows={rows}
                maxMarks={assignment.maxMarks}
                editable={canGrade}
              />
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card title="Progress">
            <DescriptionList
              items={[
                { label: "Graded", value: `${totals.gradedCount} of ${rows.length}` },
                { label: "Not submitted", value: totals.pendingCount },
                { label: "Late", value: rows.filter((r) => r.wasLate).length },
                { label: "Class average", value: formatPercentage(totals.percentage) },
              ]}
            />
          </Card>

          {!published && canPublish ? (
            <Card title="Publish">
              <ActionForm action={publishAssignmentAction.bind(null, assignment.id)} hidden={hidden} submitLabel="Publish to section" variant="primary">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Once published it can be graded, and it can no longer be deleted.</p>
              </ActionForm>
            </Card>
          ) : null}

          {!published && canEdit && assignment._count.submissions === 0 ? (
            <Card title="Danger zone">
              <form action={deleteAssignmentAction} className="flex flex-col gap-2">
                <input type="hidden" name="branchId" value={ctx.branch.id} />
                <input type="hidden" name="assignmentId" value={assignment.id} />
                <p className="text-xs text-zinc-500 dark:text-zinc-400">An unpublished assignment with no submissions can be deleted outright.</p>
                <div>
                  <Button type="submit" variant="danger">
                    Delete assignment
                  </Button>
                </div>
              </form>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
