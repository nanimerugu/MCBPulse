import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadHrAccess, param } from "@/modules/sis/access";
import { listStaffForHr } from "@/modules/hr/compensation.service";
import { listStaffLeave } from "@/modules/hr/staff-leave.service";
import { LEAVE_STATUS_LABELS, LEAVE_STATUS_TONES, leaveDayCount } from "@/modules/hr/leave";
import { formatDate } from "@/modules/sis/labels";
import { decideStaffLeaveAction, requestStaffLeaveAction } from "@/app/(app)/hr/actions";

export default async function StaffLeavePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadHrAccess(param(sp, "branch"), "hr.leave", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Staff leave" />
        <AccessDenied result={result} permission="hr.leave:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;

  const [requests, staff, held] = await Promise.all([
    listStaffLeave(ctx.organizationId, ctx.branch.id),
    listStaffForHr(ctx.organizationId, ctx.branch.id),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
  ]);

  const hidden = { branchId: ctx.branch.id };
  const active = staff.filter((s) => !s.exitDate);
  const pending = requests.filter((r) => r.status === "PENDING");
  const decided = requests.filter((r) => r.status !== "PENDING");

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Staff leave"
        description={`${ctx.branch.name} · ${pending.length} awaiting a decision`}
        actions={<LinkButton href={withBranch("/hr", ctx)}>Back to HR</LinkButton>}
      />

      {held.has("hr.leave:create") ? (
        <Card title="Record a request">
          <ActionForm action={requestStaffLeaveAction} hidden={hidden} submitLabel="Record request">
            <div className="flex flex-wrap gap-3">
              <Field label="Staff member" htmlFor="lv-staff">
                <Select id="lv-staff" name="staffId" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {active.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.user.name} ({s.employeeCode})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="From" htmlFor="lv-from">
                <Input id="lv-from" name="fromDate" type="date" required />
              </Field>
              <Field label="To" htmlFor="lv-to">
                <Input id="lv-to" name="toDate" type="date" required />
              </Field>
            </div>
            <Field label="Reason" htmlFor="lv-reason" hint="Overlapping a pending or approved request is refused.">
              <Input id="lv-reason" name="reason" required maxLength={500} placeholder="Medical leave" />
            </Field>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
              <input type="checkbox" name="unpaid" /> Unpaid leave — deduct these days from pay once approved
            </label>
          </ActionForm>
        </Card>
      ) : null}

      <Card title="Awaiting a decision">
        {pending.length === 0 ? (
          <EmptyState>Nothing pending.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {pending.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <Link href={withBranch(`/hr/people/${l.staffId}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                    {l.staff?.user.name}
                  </Link>
                  <p className="text-zinc-500 dark:text-zinc-400">
                    {formatDate(l.fromDate)} – {formatDate(l.toDate)} · {leaveDayCount(l)} day{leaveDayCount(l) === 1 ? "" : "s"} · {l.reason}
                    {l.unpaid ? (
                      <>
                        {" "}
                        <Badge tone="amber">unpaid</Badge>
                      </>
                    ) : null}
                  </p>
                </div>
                {held.has("hr.leave:approve") ? (
                  <div className="flex items-center gap-2">
                    <ActionForm action={decideStaffLeaveAction.bind(null, l.id, "APPROVED")} hidden={hidden} submitLabel="Approve" inline />
                    <ActionForm action={decideStaffLeaveAction.bind(null, l.id, "REJECTED")} hidden={hidden} submitLabel="Reject" variant="danger" inline />
                  </div>
                ) : (
                  <Badge tone="amber">pending</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Decided">
        {decided.length === 0 ? (
          <EmptyState>Nothing decided yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {decided.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">{l.staff?.user.name}</span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {" "}
                    · {formatDate(l.fromDate)} – {formatDate(l.toDate)} · {l.reason}
                    {l.unpaid ? " · unpaid" : ""}
                  </span>
                </span>
                <Badge tone={LEAVE_STATUS_TONES[l.status]}>{LEAVE_STATUS_LABELS[l.status].toLowerCase()}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
