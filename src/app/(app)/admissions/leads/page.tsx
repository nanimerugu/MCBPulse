import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { Badge, Button, EmptyState, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadAdmissionsAccess, param } from "@/modules/sis/access";
import { LEAD_STAGE_LABELS, LEAD_STAGE_ORDER, isLeadStage } from "@/modules/admissions/pipeline";
import { listLeads } from "@/modules/admissions/leads.service";
import { formatDate } from "@/modules/sis/labels";
import type { LeadStage } from "@/generated/prisma/enums";
import type { BadgeTone } from "@/components/ui";

const STAGE_TONES: Record<LeadStage, BadgeTone> = {
  NEW: "blue",
  CONTACTED: "neutral",
  QUALIFIED: "amber",
  APPLIED: "amber",
  ADMITTED: "green",
  LOST: "red",
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadAdmissionsAccess(param(sp, "branch"), "admissions.leads", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Leads" />
        <AccessDenied result={result} permission="admissions.leads:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const tenant = { organizationId: ctx.organizationId, branchId: ctx.branch.id };

  const q = param(sp, "q") ?? "";
  const stageParam = param(sp, "stage") ?? "";
  const stage = isLeadStage(stageParam) ? stageParam : undefined;
  const mine = param(sp, "mine") === "1";
  const page = Math.max(1, Number(param(sp, "page") ?? "1") || 1);

  const [data, canCreate, canExport] = await Promise.all([
    listLeads({ ...tenant, q, stage, counselorUserId: mine ? viewer.userId : undefined, page }),
    authorize(viewer.userId, "admissions.leads", "create", tenant),
    authorize(viewer.userId, "admissions.leads", "export", tenant),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Leads"
        description={`${ctx.branch.name} · ${data.total} lead${data.total === 1 ? "" : "s"}`}
        actions={
          <>
            <LinkButton href={withBranch("/admissions", ctx)}>← Funnel</LinkButton>
            {canExport ? <LinkButton href={withBranch("/admissions/leads/export", ctx)}>Export CSV</LinkButton> : null}
            {canCreate ? (
              <LinkButton href={withBranch("/admissions/leads/new", ctx)} variant="primary">
                New lead
              </LinkButton>
            ) : null}
          </>
        }
      />

      <form method="get" action="/admissions/leads" className="flex flex-wrap items-end gap-3">
        {ctx.branches.length > 1 ? <input type="hidden" name="branch" value={ctx.branch.id} /> : null}
        <div className="min-w-64 flex-1">
          <Input name="q" defaultValue={q} placeholder="Name, phone or email" aria-label="Search" />
        </div>
        <Select name="stage" defaultValue={stage ?? ""} aria-label="Stage" className="w-40">
          <option value="">Any stage</option>
          {LEAD_STAGE_ORDER.map((s) => (
            <option key={s} value={s}>
              {LEAD_STAGE_LABELS[s]}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" name="mine" value="1" defaultChecked={mine} className="h-4 w-4" /> Assigned to me
        </label>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      {data.items.length === 0 ? (
        <EmptyState>{q || stage || mine ? "No leads match these filters." : "No leads yet. Add one, or share the public enquiry form."}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">Stage</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Counselor</th>
                <th className="px-4 py-2 font-medium">Follow-up</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {data.items.map((l) => (
                <tr key={l.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                  <td className="px-4 py-2">
                    <Link href={withBranch(`/admissions/leads/${l.id}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                      {l.name}
                    </Link>
                    {l.applications.length > 0 ? <span className="ml-2 text-xs text-zinc-500">{l.applications.length} app.</span> : null}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-300">{l.phone}</td>
                  <td className="px-4 py-2">
                    <Badge tone={STAGE_TONES[l.stage]}>{LEAD_STAGE_LABELS[l.stage]}</Badge>
                  </td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">{l.source?.name ?? "—"}</td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">{l.counselorName ?? "—"}</td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">{formatDate(l.nextFollowUpAt)}</td>
                  <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{formatDate(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.pageCount > 1 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Page {data.page} of {data.pageCount}
        </p>
      ) : null}
    </div>
  );
}
