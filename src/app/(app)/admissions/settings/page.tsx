import { authorize } from "@/lib/rbac";
import { Card, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadAdmissionsAccess, param } from "@/modules/sis/access";
import { listCampaigns, listSources } from "@/modules/admissions/leads.service";
import { formatDate } from "@/modules/sis/labels";
import { createCampaignAction, createSourceAction } from "@/app/(app)/admissions/actions";

export default async function AdmissionsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadAdmissionsAccess(param(sp, "branch"), "admissions.settings", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Sources & campaigns" />
        <AccessDenied result={result} permission="admissions.settings:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const [sources, campaigns, canConfigure] = await Promise.all([
    listSources(ctx.organizationId),
    listCampaigns(ctx.organizationId),
    authorize(viewer.userId, "admissions.settings", "configure", { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
  ]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Sources & campaigns" description="Where leads come from. Organization-wide." />

      <Card title={`Lead sources (${sources.length})`}>
        {sources.length === 0 ? (
          <EmptyState>No sources yet. The public form creates a &quot;Website&quot; source automatically.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {sources.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-1.5">
                <span className="text-zinc-900 dark:text-zinc-50">{s.name}</span>
                <span className="text-xs text-zinc-500">{s._count.leads} lead{s._count.leads === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        )}
        {canConfigure ? (
          <div className="mt-4">
            <ActionForm action={createSourceAction} hidden={{ branchId: ctx.branch.id }} submitLabel="Add source" inline>
              <Input name="name" placeholder="e.g. Newspaper ad" required className="w-56" aria-label="Source name" />
            </ActionForm>
          </div>
        ) : null}
      </Card>

      <Card title={`Campaigns (${campaigns.length})`}>
        {campaigns.length === 0 ? (
          <EmptyState>No campaigns yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {campaigns.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-1.5">
                <span className="text-zinc-900 dark:text-zinc-50">
                  {c.name} <span className="text-xs text-zinc-500">· {c.channel.replace("_", " ").toLowerCase()}</span>
                </span>
                <span className="text-xs text-zinc-500">
                  {formatDate(c.startDate)} → {c.endDate ? formatDate(c.endDate) : "open"} · {c._count.leads} lead{c._count.leads === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canConfigure ? (
          <div className="mt-4">
            <ActionForm action={createCampaignAction} hidden={{ branchId: ctx.branch.id }} submitLabel="Add campaign">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <Field label="Name" htmlFor="camp-name">
                  <Input id="camp-name" name="name" required />
                </Field>
                <Field label="Channel" htmlFor="camp-channel">
                  <Select id="camp-channel" name="channel" defaultValue="SOCIAL">
                    <option value="SOCIAL">Social</option>
                    <option value="LANDING_PAGE">Landing page</option>
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="SMS">SMS</option>
                    <option value="EMAIL">Email</option>
                  </Select>
                </Field>
                <Field label="Start" htmlFor="camp-start">
                  <Input id="camp-start" name="startDate" type="date" required />
                </Field>
                <Field label="End (optional)" htmlFor="camp-end">
                  <Input id="camp-end" name="endDate" type="date" />
                </Field>
              </div>
            </ActionForm>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
