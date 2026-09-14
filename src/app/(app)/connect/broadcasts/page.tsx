import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { db } from "@/lib/db";
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadConnectAccess, param } from "@/modules/sis/access";
import { listBroadcasts } from "@/modules/connect/broadcasts.service";
import { listEnrollableSections } from "@/modules/sis/students.service";
import { AUDIENCE_LABELS } from "@/modules/connect/audience";
import { CHANNEL_LABELS } from "@/modules/connect/delivery-policy";
import { TEMPLATE_VARIABLE_KEYS } from "@/modules/connect/templates";
import { formatDate } from "@/modules/sis/labels";
import { createBroadcastAction } from "@/app/(app)/connect/actions";

export default async function BroadcastsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadConnectAccess(param(sp, "branch"), "connect.broadcasts", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Broadcasts" />
        <AccessDenied result={result} permission="connect.broadcasts:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const [broadcasts, sections, grades, canCreate] = await Promise.all([
    listBroadcasts(ctx.organizationId),
    listEnrollableSections(ctx.branch.id),
    db.grade.findMany({ where: { branchId: ctx.branch.id, deletedAt: null }, orderBy: { sequence: "asc" } }),
    authorize(viewer.userId, "connect.broadcasts", "create", { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
  ]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Broadcasts" description={ctx.branch.name} actions={<LinkButton href={withBranch("/connect", ctx)}>← Communication</LinkButton>} />

      {broadcasts.length === 0 ? (
        <EmptyState>No broadcasts yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">Message</th>
                <th className="px-4 py-2 font-medium">Channel</th>
                <th className="px-4 py-2 text-right font-medium">Messages</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {broadcasts.map((b) => (
                <tr key={b.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                  <td className="px-4 py-2">
                    <Link href={withBranch(`/connect/broadcasts/${b.id}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                      {b.subject || b.body.slice(0, 60)}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">{CHANNEL_LABELS[b.channel]}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{b._count.messages}</td>
                  <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{formatDate(b.createdAt)}</td>
                  <td className="px-4 py-2">
                    <Badge tone={b.status === "SENT" ? "green" : b.status === "FAILED" ? "red" : b.status === "SCHEDULED" ? "amber" : "neutral"}>{b.status.toLowerCase()}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canCreate ? (
        <Card title="New broadcast">
          <ActionForm action={createBroadcastAction} hidden={{ branchId: ctx.branch.id }} submitLabel="Create draft" pendingLabel="Creating…" variant="primary">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Channel" htmlFor="b-channel">
                <Select id="b-channel" name="channel" defaultValue="SMS">
                  <option value="SMS">SMS</option>
                  <option value="EMAIL">Email</option>
                  <option value="WHATSAPP">WhatsApp</option>
                </Select>
              </Field>
              <Field label="Audience" htmlFor="b-audience">
                <Select id="b-audience" name="audienceKind" defaultValue="all_guardians">
                  {(Object.keys(AUDIENCE_LABELS) as (keyof typeof AUDIENCE_LABELS)[]).map((k) => (
                    <option key={k} value={k}>
                      {AUDIENCE_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Section (if audience is one section)" htmlFor="b-section">
                <Select id="b-section" name="sectionId" defaultValue="">
                  <option value="">—</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.grade.name} / {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Grade (if audience is one grade)" htmlFor="b-grade">
                <Select id="b-grade" name="gradeId" defaultValue="">
                  <option value="">—</option>
                  {grades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Subject (email only)" htmlFor="b-subject">
                <Input id="b-subject" name="subject" />
              </Field>
              <Field label="Schedule for (optional)" htmlFor="b-scheduled" hint="On this campus&apos;s clock. The scheduler sends it at that time.">
                <Input id="b-scheduled" name="scheduledAt" type="datetime-local" />
              </Field>
            </div>
            <Field label="Body" htmlFor="b-body" hint={`Variables: ${TEMPLATE_VARIABLE_KEYS.slice(0, 5).map((k) => `{{${k}}}`).join(" ")} …`}>
              <Textarea id="b-body" name="body" rows={3} required placeholder="e.g. {{school.name}}: PTM on Saturday for {{student.first_name}}." />
            </Field>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Created as a draft — you&apos;ll see exactly who would receive it, and the rendered text, before anything is sent.</p>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
