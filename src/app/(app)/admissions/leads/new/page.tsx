import { withBranch } from "@/lib/branch-context";
import { Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadAdmissionsAccess, param } from "@/modules/sis/access";
import { listCampaigns, listSources } from "@/modules/admissions/leads.service";
import { createLeadAction } from "@/app/(app)/admissions/actions";

export default async function NewLeadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadAdmissionsAccess(param(sp, "branch"), "admissions.leads", "create");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="New lead" />
        <AccessDenied result={result} permission="admissions.leads:create" />
      </>
    );
  }
  const { ctx } = result.access;
  const [sources, campaigns] = await Promise.all([listSources(ctx.organizationId), listCampaigns(ctx.organizationId)]);

  return (
    <>
      <PageHeader
        title="New lead"
        description={`The enquiring parent or guardian, in ${ctx.branch.name}. Duplicates are caught on phone number.`}
        actions={<LinkButton href={withBranch("/admissions/leads", ctx)}>Cancel</LinkButton>}
      />
      <div className="max-w-2xl">
        <ActionForm action={createLeadAction} hidden={{ branchId: ctx.branch.id }} submitLabel="Create lead" pendingLabel="Creating…" variant="primary">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="lead-name">
              <Input id="lead-name" name="name" required />
            </Field>
            <Field label="Phone" htmlFor="lead-phone">
              <Input id="lead-phone" name="phone" type="tel" required />
            </Field>
            <Field label="Email" htmlFor="lead-email">
              <Input id="lead-email" name="email" type="email" />
            </Field>
            <Field label="Source" htmlFor="lead-source">
              <Select id="lead-source" name="sourceId" defaultValue="">
                <option value="">—</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Campaign" htmlFor="lead-campaign">
              <Select id="lead-campaign" name="campaignId" defaultValue="">
                <option value="">—</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="First note" htmlFor="lead-note" hint="Grade of interest, how they heard of us, anything said on the call.">
            <Textarea id="lead-note" name="note" rows={3} />
          </Field>
        </ActionForm>
      </div>
    </>
  );
}
