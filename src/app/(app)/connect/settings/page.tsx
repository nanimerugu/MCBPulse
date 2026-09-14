import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { db } from "@/lib/db";
import { Badge, Button, Card, EmptyState, Field, Input, LinkButton, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadConnectAccess, param } from "@/modules/sis/access";
import { fullName } from "@/modules/sis/labels";
import { branchTimeZone } from "@/modules/connect/quiet-hours";
import { setOptOutAction, setQuietHoursAction } from "@/app/(app)/connect/actions";

export default async function ConnectSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadConnectAccess(param(sp, "branch"), "connect.settings", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Quiet hours & consent" />
        <AccessDenied result={result} permission="connect.settings:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;

  const [org, guardians, canConfigure, tz] = await Promise.all([
    db.organization.findUnique({ where: { id: ctx.organizationId }, select: { quietHoursStart: true, quietHoursEnd: true } }),
    db.guardian.findMany({
      where: { deletedAt: null, studentLinks: { some: { student: { organizationId: ctx.organizationId, branchId: ctx.branch.id, deletedAt: null } } } },
      include: { studentLinks: { include: { student: { select: { firstName: true, lastName: true } } }, take: 3 } },
      orderBy: { lastName: "asc" },
      take: 100,
    }),
    authorize(viewer.userId, "connect.settings", "configure", { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
    branchTimeZone(ctx.branch.id),
  ]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Quiet hours & consent" actions={<LinkButton href={withBranch("/connect", ctx)}>← Communication</LinkButton>} />

      <Card title="Quiet hours">
        <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          The school&apos;s promise not to contact families outside these hours. A send inside the window is held, and the scheduler sends it when the
          window closes. A window whose end is before its start wraps midnight (21:00–07:00). Times are read on each campus&apos;s own clock —{" "}
          {ctx.branch.name} is on <span className="font-mono">{tz}</span>.
        </p>
        {canConfigure ? (
          <ActionForm action={setQuietHoursAction} hidden={{ branchId: ctx.branch.id }} submitLabel="Save quiet hours" inline>
            <Field label="From" htmlFor="qh-start">
              <Input id="qh-start" name="start" type="time" defaultValue={org?.quietHoursStart ?? ""} className="w-32" />
            </Field>
            <Field label="Until" htmlFor="qh-end">
              <Input id="qh-end" name="end" type="time" defaultValue={org?.quietHoursEnd ?? ""} className="w-32" />
            </Field>
          </ActionForm>
        ) : (
          <p className="text-sm text-zinc-700 dark:text-zinc-200">
            {org?.quietHoursStart && org?.quietHoursEnd ? `${org.quietHoursStart} – ${org.quietHoursEnd}` : "No quiet hours configured."}
          </p>
        )}
      </Card>

      <Card title={`Guardian consent (${guardians.length})`}>
        <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          An opt-out suppresses delivery on that channel and is reported back to whoever sends, rather than silently dropping the message.
        </p>
        {guardians.length === 0 ? (
          <EmptyState>No guardians in this branch.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Guardian</th>
                  <th className="px-3 py-2 font-medium">Children</th>
                  <th className="px-3 py-2 font-medium">SMS</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  {canConfigure ? <th className="px-3 py-2 font-medium"></th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {guardians.map((g) => (
                  <tr key={g.id}>
                    <td className="px-3 py-1.5">
                      <span className="text-zinc-900 dark:text-zinc-50">{fullName(g)}</span>{" "}
                      <span className="font-mono text-xs text-zinc-500">{g.phone}</span>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">{g.studentLinks.map((l) => fullName(l.student)).join(", ")}</td>
                    <td className="px-3 py-1.5">
                      <Badge tone={g.optOutSms ? "red" : "green"}>{g.optOutSms ? "opted out" : "ok"}</Badge>
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge tone={g.optOutEmail ? "red" : "green"}>{g.optOutEmail ? "opted out" : "ok"}</Badge>
                    </td>
                    {canConfigure ? (
                      <td className="px-3 py-1.5">
                        <div className="flex gap-1">
                          <form action={setOptOutAction}>
                            <input type="hidden" name="branchId" value={ctx.branch.id} />
                            <input type="hidden" name="guardianId" value={g.id} />
                            <input type="hidden" name="optOutSms" value={g.optOutSms ? "false" : "true"} />
                            <input type="hidden" name="optOutEmail" value={String(g.optOutEmail)} />
                            <Button type="submit" variant="secondary" className="!px-2 !py-0.5 text-xs">
                              {g.optOutSms ? "Allow SMS" : "Stop SMS"}
                            </Button>
                          </form>
                          <form action={setOptOutAction}>
                            <input type="hidden" name="branchId" value={ctx.branch.id} />
                            <input type="hidden" name="guardianId" value={g.id} />
                            <input type="hidden" name="optOutSms" value={String(g.optOutSms)} />
                            <input type="hidden" name="optOutEmail" value={g.optOutEmail ? "false" : "true"} />
                            <Button type="submit" variant="secondary" className="!px-2 !py-0.5 text-xs">
                              {g.optOutEmail ? "Allow email" : "Stop email"}
                            </Button>
                          </form>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
