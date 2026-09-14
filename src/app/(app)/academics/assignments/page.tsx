import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { Button, EmptyState, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadAcademicsAccess, param } from "@/modules/sis/access";
import { listEnrollableSections } from "@/modules/sis/students.service";
import { listAssignments, listTeachingStaff } from "@/modules/academics/assignments.service";
import { listSubjects } from "@/modules/academics/subjects.service";
import { getSectionScope, sectionInScope } from "@/modules/academics/scope";
import { removeAssignmentAction, setAssignmentAction } from "@/app/(app)/academics/actions";
import { AssignmentRow } from "@/app/(app)/academics/assignments/assignment-row";

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadAcademicsAccess(param(sp, "branch"), "academics.assignments", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Teaching assignments" />
        <AccessDenied result={result} permission="academics.assignments:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const scope = await getSectionScope(result.access);

  const allSections = await listEnrollableSections(ctx.branch.id);
  const sections = allSections.filter((s) => sectionInScope(scope, s.id));
  const requested = param(sp, "section");
  const section = sections.find((s) => s.id === requested) ?? sections[0];

  const [assignments, subjects, staff, canConfigure] = section
    ? await Promise.all([
        listAssignments(section.id, ctx.organizationId),
        listSubjects(ctx.organizationId),
        listTeachingStaff(ctx.organizationId, ctx.branch.id),
        authorize(viewer.userId, "academics.assignments", "configure", { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
      ])
    : [[], [], [], false];

  const staffOptions = staff.map((s) => ({ id: s.id, label: `${s.user.name} (${s.employeeCode})` }));
  const bySubject = new Map(assignments.map((a) => [a.subjectId, a]));

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader
        title="Teaching assignments"
        description="Which teacher takes which subject in which section. A teacher's assignments are also what scopes what they can see."
      />

      {sections.length === 0 ? (
        <EmptyState>
          {scope.sectionIds !== null ? "You aren't assigned to any section yet." : "No sections in the current academic year — set up grades and sections first."}
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-zinc-500 dark:text-zinc-400">Section:</span>
            {sections.map((s) => (
              <Link
                key={s.id}
                href={withBranch(`/academics/assignments?section=${s.id}`, ctx)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  s.id === section?.id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
              >
                {s.grade.name} / {s.name}
              </Link>
            ))}
          </div>

          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Subject</th>
                  <th className="px-4 py-2 font-medium">Teacher</th>
                  {canConfigure ? <th className="px-4 py-2 font-medium"></th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {subjects.map((subject) => {
                  const a = bySubject.get(subject.id);
                  return (
                    <tr key={subject.id}>
                      <td className="px-4 py-2 text-zinc-900 dark:text-zinc-50">
                        {subject.name} <span className="font-mono text-xs text-zinc-500">{subject.code}</span>
                      </td>
                      <td className="px-4 py-2">
                        {canConfigure && section ? (
                          <AssignmentRow
                            action={setAssignmentAction}
                            branchId={ctx.branch.id}
                            sectionId={section.id}
                            subjectId={subject.id}
                            currentStaffId={a?.staffId ?? null}
                            staff={staffOptions}
                          />
                        ) : a ? (
                          <span className="text-zinc-900 dark:text-zinc-50">
                            {a.staff.user.name} <span className="text-xs text-zinc-500">({a.staff.employeeCode})</span>
                          </span>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      {canConfigure ? (
                        <td className="px-4 py-2 text-right">
                          {a ? (
                            <form action={removeAssignmentAction}>
                              <input type="hidden" name="branchId" value={ctx.branch.id} />
                              <input type="hidden" name="assignmentId" value={a.id} />
                              <Button type="submit" variant="danger" className="!px-2.5 !py-1 text-xs">
                                Remove
                              </Button>
                            </form>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
