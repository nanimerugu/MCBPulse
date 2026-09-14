import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { Badge, Button, Card, EmptyState, Input, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadAcademicsAccess, param } from "@/modules/sis/access";
import { listEnrollableSections } from "@/modules/sis/students.service";
import { getRegister, sectionSummary } from "@/modules/academics/attendance.service";
import { formatRate, summarize } from "@/modules/academics/attendance-summary";
import { getSectionScope, sectionInScope } from "@/modules/academics/scope";
import { saveRegisterAction, setLockAction } from "@/app/(app)/academics/actions";
import { RegisterForm } from "@/app/(app)/academics/attendance/register-form";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadAcademicsAccess(param(sp, "branch"), "academics.attendance", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Attendance" />
        <AccessDenied result={result} permission="academics.attendance:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const scope = await getSectionScope(result.access);
  const tenant = { organizationId: ctx.organizationId, branchId: ctx.branch.id };

  const allSections = await listEnrollableSections(ctx.branch.id);
  const sections = allSections.filter((s) => sectionInScope(scope, s.id));
  const requested = param(sp, "section");
  const section = sections.find((s) => s.id === requested) ?? sections[0];
  const dateParam = param(sp, "date");
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayISO();

  const [register, summary, canCreate, canEdit, canApprove] = section
    ? await Promise.all([
        getRegister(section.id, date, ctx.organizationId),
        sectionSummary(section.id, daysAgoISO(30), date),
        authorize(viewer.userId, "academics.attendance", "create", tenant),
        authorize(viewer.userId, "academics.attendance", "edit", tenant),
        authorize(viewer.userId, "academics.attendance", "approve", tenant),
      ])
    : [null, null, false, false, false];

  const locked = Boolean(register?.session?.lockedAt);
  const editable = register ? (register.session ? (locked ? canApprove : canEdit || canApprove) : canCreate) : false;
  const dayCounts = register?.session ? summarize(register.session.records.map((r) => r.status)) : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Attendance"
        description={section ? `${section.grade.name} / ${section.name} · ${ctx.branch.name}` : ctx.branch.name}
      />

      {sections.length === 0 ? (
        <EmptyState>{scope.sectionIds !== null ? "You aren't assigned to any section yet." : "No sections in the current academic year."}</EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">Section:</span>
              {sections.map((s) => (
                <Link
                  key={s.id}
                  href={withBranch(`/academics/attendance?section=${s.id}&date=${date}`, ctx)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    s.id === section?.id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {s.grade.name} / {s.name}
                </Link>
              ))}
            </div>
            <form method="get" action="/academics/attendance" className="flex items-end gap-2">
              {ctx.branches.length > 1 ? <input type="hidden" name="branch" value={ctx.branch.id} /> : null}
              <input type="hidden" name="section" value={section?.id ?? ""} />
              <Input type="date" name="date" defaultValue={date} aria-label="Date" className="w-40" />
              <Button type="submit" variant="secondary">
                Go
              </Button>
            </form>
          </div>

          {register && section ? (
            <Card
              title={`Register for ${date}`}
              actions={
                <div className="flex items-center gap-2 text-xs">
                  {register.session ? (
                    <>
                      <Badge tone={locked ? "amber" : "green"}>{locked ? "Locked" : "Open"}</Badge>
                      <span className="text-zinc-500 dark:text-zinc-400">
                        taken by {register.session.takenByStaff?.user.name ?? "an administrator"}
                        {dayCounts ? ` · ${dayCounts.present + dayCounts.late}/${dayCounts.total - dayCounts.excused} attended` : ""}
                      </span>
                      {canApprove ? (
                        <form action={setLockAction}>
                          <input type="hidden" name="branchId" value={ctx.branch.id} />
                          <input type="hidden" name="sessionId" value={register.session.id} />
                          <input type="hidden" name="locked" value={locked ? "false" : "true"} />
                          <Button type="submit" variant="secondary" className="!px-2.5 !py-1 text-xs">
                            {locked ? "Unlock" : "Lock"}
                          </Button>
                        </form>
                      ) : null}
                    </>
                  ) : (
                    <Badge tone="neutral">Not yet taken</Badge>
                  )}
                </div>
              }
            >
              {register.rows.length === 0 ? (
                <EmptyState>No enrolled students in this section.</EmptyState>
              ) : (
                <RegisterForm
                  action={saveRegisterAction}
                  branchId={ctx.branch.id}
                  sectionId={section.id}
                  date={date}
                  rows={register.rows}
                  editable={editable}
                  locked={locked}
                />
              )}
            </Card>
          ) : null}

          {summary && section ? (
            <Card title={`Last 30 days · ${summary.sessions} register${summary.sessions === 1 ? "" : "s"}`}>
              {summary.rows.length === 0 ? (
                <EmptyState>No attendance recorded in this period.</EmptyState>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    <tr>
                      <th className="py-1 pr-4 font-medium">Student</th>
                      <th className="py-1 pr-4 font-medium">Present</th>
                      <th className="py-1 pr-4 font-medium">Late</th>
                      <th className="py-1 pr-4 font-medium">Absent</th>
                      <th className="py-1 pr-4 font-medium">Excused</th>
                      <th className="py-1 font-medium">Attended</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {summary.rows.map((r) => (
                      <tr key={r.studentId}>
                        <td className="py-1.5 pr-4 text-zinc-900 dark:text-zinc-50">
                          <Link href={withBranch(`/students/${r.studentId}`, ctx)} className="hover:underline">
                            {r.name}
                          </Link>
                        </td>
                        <td className="py-1.5 pr-4">{r.counts.present}</td>
                        <td className="py-1.5 pr-4">{r.counts.late}</td>
                        <td className="py-1.5 pr-4">{r.counts.absent}</td>
                        <td className="py-1.5 pr-4">{r.counts.excused}</td>
                        <td className="py-1.5 font-medium">{formatRate(r.counts.attendedRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
