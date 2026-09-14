import { withBranch } from "@/lib/branch-context";
import { db } from "@/lib/db";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadOpsAccess, param } from "@/modules/sis/access";
import { listVisitors, VISITOR_KINDS, VISITOR_KIND_LABELS } from "@/modules/operations/campus.service";
import { checkInVisitorAction, checkOutVisitorAction } from "@/app/(app)/operations/actions";

function time(d: Date): string {
  return d.toISOString().slice(11, 16);
}

export default async function VisitorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadOpsAccess(param(sp, "branch"), "ops.visitors", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Gate register" />
        <AccessDenied result={result} permission="ops.visitors:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;

  const [visits, held, students] = await Promise.all([
    listVisitors({ organizationId: ctx.organizationId, branchId: ctx.branch.id }),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
    db.student.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null, status: "ENROLLED" },
      include: { currentSection: { include: { grade: true } } },
      orderBy: { firstName: "asc" },
      take: 300,
    }),
  ]);

  const hidden = { branchId: ctx.branch.id };
  const canEdit = held.has("ops.visitors:edit");
  const onSite = visits.filter((v) => !v.checkOutAt);
  const departed = visits.filter((v) => v.checkOutAt);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Gate register"
        description={`${onSite.length} visitor${onSite.length === 1 ? "" : "s"} on campus right now`}
        actions={<LinkButton href={withBranch("/operations", ctx)}>Back to Operations</LinkButton>}
      />

      {canEdit ? (
        <Card title="Check in">
          <ActionForm action={checkInVisitorAction} hidden={hidden} submitLabel="Check in">
            <div className="flex flex-wrap gap-3">
              <Field label="Name" htmlFor="vs-name">
                <Input id="vs-name" name="name" required maxLength={120} />
              </Field>
              <Field label="Phone" htmlFor="vs-phone">
                <Input id="vs-phone" name="phone" maxLength={20} inputMode="tel" />
              </Field>
              <Field label="Type" htmlFor="vs-kind">
                <Select id="vs-kind" name="kind" defaultValue="GUARDIAN">
                  {VISITOR_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {VISITOR_KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Pass number" htmlFor="vs-pass">
                <Input id="vs-pass" name="passNumber" maxLength={20} />
              </Field>
            </div>
            <Field label="Purpose" htmlFor="vs-purpose">
              <Input id="vs-purpose" name="purpose" required maxLength={200} placeholder="Parent-teacher meeting" />
            </Field>
            <div className="flex flex-wrap gap-3">
              <Field label="Whom to meet" htmlFor="vs-whom">
                <Input id="vs-whom" name="whomToMeet" maxLength={120} placeholder="Ravi Kumar" />
              </Field>
              <Field label="Visiting a student" htmlFor="vs-student" hint="Optional.">
                <Select id="vs-student" name="studentId" defaultValue="">
                  <option value="">Not student-specific</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.firstName} {s.lastName}
                      {s.currentSection ? ` (${s.currentSection.grade.name}/${s.currentSection.name})` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </ActionForm>
        </Card>
      ) : null}

      <Card title="On campus now">
        {onSite.length === 0 ? (
          <EmptyState>Nobody is signed in.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {onSite.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">
                    {v.name} {v.passNumber ? <span className="font-mono text-xs text-zinc-500">#{v.passNumber}</span> : null}
                  </p>
                  <p className="text-zinc-500 dark:text-zinc-400">
                    {VISITOR_KIND_LABELS[v.kind]} · {v.purpose}
                    {v.whomToMeet ? ` · for ${v.whomToMeet}` : ""}
                    {v.student ? ` · re ${v.student.firstName} ${v.student.lastName}` : ""} · in at {time(v.checkInAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="green">on site</Badge>
                  {canEdit ? <ActionForm action={checkOutVisitorAction.bind(null, v.id)} hidden={hidden} submitLabel="Check out" inline /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Earlier today and before">
        {departed.length === 0 ? (
          <EmptyState>No completed visits yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {departed.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">{v.name}</span>
                  <span className="text-zinc-500 dark:text-zinc-400"> · {v.purpose}</span>
                </span>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {time(v.checkInAt)} – {v.checkOutAt ? time(v.checkOutAt) : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
