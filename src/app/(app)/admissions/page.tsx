import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadAdmissionsAccess, param } from "@/modules/sis/access";
import { LEAD_STAGE_LABELS, LEAD_STAGE_ORDER } from "@/modules/admissions/pipeline";
import { dueFollowUps, funnelCounts } from "@/modules/admissions/leads.service";
import { formatDate } from "@/modules/sis/labels";

export default async function AdmissionsIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadAdmissionsAccess(param(sp, "branch"), "admissions.leads", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Admissions" />
        <AccessDenied result={result} permission="admissions.leads:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const [funnel, due] = await Promise.all([funnelCounts(ctx.organizationId, ctx.branch.id), dueFollowUps(ctx.organizationId, ctx.branch.id, viewer.userId)]);
  const total = Object.values(funnel).reduce((a, b) => a + b, 0);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Admissions"
        description={`${ctx.branch.name} · ${total} lead${total === 1 ? "" : "s"} · public enquiry form at /apply/<org>/${ctx.branch.code}`}
        actions={
          <>
            <LinkButton href={withBranch("/admissions/settings", ctx)}>Sources & campaigns</LinkButton>
            <LinkButton href={withBranch("/admissions/leads", ctx)} variant="primary">
              All leads
            </LinkButton>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {LEAD_STAGE_ORDER.map((stage) => (
          <Link
            key={stage}
            href={withBranch(`/admissions/leads?stage=${stage}`, ctx)}
            className="rounded-lg border border-zinc-200 p-4 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{LEAD_STAGE_LABELS[stage]}</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{funnel[stage]}</p>
          </Link>
        ))}
      </div>

      <Card title="Your follow-ups due">
        {due.length === 0 ? (
          <EmptyState>Nothing due. Follow-ups you set on leads assigned to you appear here on their day.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {due.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-2 text-sm">
                <Link href={withBranch(`/admissions/leads/${l.id}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                  {l.name}
                </Link>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {l.phone} · {LEAD_STAGE_LABELS[l.stage]} · due {formatDate(l.nextFollowUpAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
