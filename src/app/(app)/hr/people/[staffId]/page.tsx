import { notFound } from "next/navigation";
import { withBranch } from "@/lib/branch-context";
import { db } from "@/lib/db";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, DescriptionList, EmptyState, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadHrAccess, param } from "@/modules/sis/access";
import { getStaffForHr } from "@/modules/hr/compensation.service";
import { listDepartments, listPositions } from "@/modules/hr/org.service";
import { listStaffLeave } from "@/modules/hr/staff-leave.service";
import { formatMoney, toMinor } from "@/modules/finance/money";
import { LEAVE_STATUS_LABELS, LEAVE_STATUS_TONES, leaveDayCount } from "@/modules/hr/leave";
import { periodLabel } from "@/modules/hr/payroll";
import { formatDate } from "@/modules/sis/labels";
import { assignOrgUnitAction, recordAppraisalAction, recordExitAction, setPayAction } from "@/app/(app)/hr/actions";

export default async function HrStaffPage({
  params,
  searchParams,
}: {
  params: Promise<{ staffId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ staffId }, sp] = await Promise.all([params, searchParams]);
  const result = await loadHrAccess(param(sp, "branch"), "hr.org", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Staff member" />
        <AccessDenied result={result} permission="hr.org:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;

  const [staff, held] = await Promise.all([getStaffForHr(staffId, ctx.organizationId), heldPermissionKeys(viewer.userId, ctx.organizationId)]);
  if (!staff) notFound();

  const [departments, positions, leave, years] = await Promise.all([
    listDepartments(ctx.organizationId),
    listPositions(ctx.organizationId),
    held.has("hr.leave:view") ? listStaffLeave(ctx.organizationId, ctx.branch.id, { staffId }) : Promise.resolve([]),
    db.academicYear.findMany({ where: { branchId: ctx.branch.id }, orderBy: { startDate: "desc" } }),
  ]);

  const canSeePay = held.has("hr.compensation:view");
  const hidden = { branchId: ctx.branch.id };
  const payMinor = staff.monthlyGrossPay === null ? null : toMinor(staff.monthlyGrossPay);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={staff.user.name}
        description={`${staff.employeeCode} · ${staff.position?.title ?? staff.designation}`}
        actions={<LinkButton href={withBranch("/hr/people", ctx)}>Back to people</LinkButton>}
      />

      {staff.exitDate ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          Exited on {formatDate(staff.exitDate)}
          {staff.exitReason ? ` — ${staff.exitReason}` : ""}. Their login is disabled; the record stays for payslip and audit history.
        </div>
      ) : null}

      <Card title="Employment">
        <DescriptionList
          items={[
            { label: "Email", value: staff.user.email },
            { label: "Branch", value: staff.branch?.name ?? "—" },
            { label: "Department", value: staff.department?.name ?? "—" },
            { label: "Position", value: staff.position?.title ?? "—" },
            { label: "Joined", value: formatDate(staff.joinDate) },
            ...(canSeePay ? [{ label: "Monthly gross", value: payMinor === null ? "Not set" : formatMoney(payMinor) }] : []),
          ]}
        />
      </Card>

      {held.has("hr.org:configure") ? (
        <Card title="Department & position">
          <ActionForm action={assignOrgUnitAction.bind(null, staffId)} hidden={hidden} submitLabel="Save" inline>
            <Field label="Department" htmlFor="dept">
              <Select id="dept" name="departmentId" defaultValue={staff.departmentId ?? ""}>
                <option value="">None</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Position" htmlFor="pos">
              <Select id="pos" name="positionId" defaultValue={staff.positionId ?? ""}>
                <option value="">None</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </Field>
          </ActionForm>
        </Card>
      ) : null}

      {held.has("hr.compensation:edit") ? (
        <Card title="Monthly gross pay">
          <ActionForm action={setPayAction.bind(null, staffId)} hidden={hidden} submitLabel="Save pay" inline>
            <Field
              label="Amount"
              htmlFor="pay"
              hint="Leave empty to clear it — cleared pay means the person is skipped by payroll, not paid zero."
            >
              <Input
                id="pay"
                name="monthlyGrossPay"
                inputMode="decimal"
                defaultValue={payMinor === null ? "" : (payMinor / 100).toFixed(2)}
                placeholder="45000.00"
              />
            </Field>
          </ActionForm>
        </Card>
      ) : null}

      {canSeePay && staff.payslips.length > 0 ? (
        <Card title="Payslips">
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {staff.payslips.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {periodLabel(p.payrollRun.periodMonth, p.payrollRun.periodYear)}
                </span>
                <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                  {formatMoney(toMinor(p.grossPay))} gross − {formatMoney(toMinor(p.deductions))} = <strong>{formatMoney(toMinor(p.netPay))}</strong>
                  <span className="ml-2">
                    <Badge tone={p.payrollRun.status === "PAID" ? "green" : "neutral"}>{p.payrollRun.status.toLowerCase()}</Badge>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {held.has("hr.leave:view") ? (
        <Card title="Leave history">
          {leave.length === 0 ? (
            <EmptyState>No leave recorded.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {leave.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <span>
                    {formatDate(l.fromDate)} – {formatDate(l.toDate)}{" "}
                    <span className="text-zinc-500 dark:text-zinc-400">
                      · {leaveDayCount(l)} day{leaveDayCount(l) === 1 ? "" : "s"} · {l.reason}
                    </span>
                  </span>
                  <Badge tone={LEAVE_STATUS_TONES[l.status]}>{LEAVE_STATUS_LABELS[l.status].toLowerCase()}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {held.has("hr.appraisals:view") ? (
        <Card title="Appraisals">
          {staff.appraisals.length === 0 ? (
            <EmptyState>No appraisal recorded.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {staff.appraisals.map((a) => (
                <li key={a.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">{a.academicYear.name}</span>
                    <span className="text-zinc-500 dark:text-zinc-400">
                      {a.score !== null ? `${a.score}/5` : "no score"} · {formatDate(a.submittedAt)}
                    </span>
                  </div>
                  {a.comments ? <p className="mt-1 text-zinc-600 dark:text-zinc-300">{a.comments}</p> : null}
                </li>
              ))}
            </ul>
          )}

          {held.has("hr.appraisals:edit") && years.length > 0 ? (
            <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <ActionForm action={recordAppraisalAction.bind(null, staffId)} hidden={hidden} submitLabel="Record appraisal">
                <div className="flex flex-wrap gap-3">
                  <Field label="Academic year" htmlFor="ap-year">
                    <Select id="ap-year" name="academicYearId" required defaultValue={years[0]?.id}>
                      {years.map((y) => (
                        <option key={y.id} value={y.id}>
                          {y.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Score" htmlFor="ap-score" hint="1 to 5, optional">
                    <Input id="ap-score" name="score" type="number" min={1} max={5} />
                  </Field>
                </div>
                <Field label="Comments" htmlFor="ap-comments">
                  <Textarea id="ap-comments" name="comments" rows={3} required maxLength={2000} />
                </Field>
              </ActionForm>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">One appraisal per year — recording again replaces that year&apos;s.</p>
            </div>
          ) : null}
        </Card>
      ) : null}

      {held.has("hr.exit:edit") && !staff.exitDate ? (
        <Card title="Record an exit">
          <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
            This disables their login immediately and takes them off payroll runs from the following month. The record itself stays.
          </p>
          <ActionForm action={recordExitAction.bind(null, staffId)} hidden={hidden} submitLabel="Record exit" variant="danger">
            <Field label="Exit date" htmlFor="exit-date">
              <Input id="exit-date" name="exitDate" type="date" required />
            </Field>
            <Field label="Reason" htmlFor="exit-reason">
              <Input id="exit-reason" name="reason" required maxLength={500} placeholder="Resignation" />
            </Field>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
