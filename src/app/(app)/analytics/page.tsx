import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { heldPermissionKeys } from "@/lib/rbac";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadAnalyticsAccess, param } from "@/modules/sis/access";
import { dashboardKpis } from "@/modules/analytics/analytics.service";
import { REPORTS } from "@/modules/analytics/reports";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadAnalyticsAccess(param(sp, "branch"), "analytics.dashboard", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Reports & analytics" />
        <AccessDenied result={result} permission="analytics.dashboard:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const [kpis, held] = await Promise.all([
    dashboardKpis({ organizationId: ctx.organizationId, branchId: ctx.branch.id }),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
  ]);

  // A report the viewer can't run isn't offered — each one needs the
  // permission of the module it reads, not just analytics.reports:view.
  const runnable = held.has("analytics.reports:view") ? REPORTS.filter((r) => held.has(`${r.requires.module}:${r.requires.action}`)) : [];
  const withheld = held.has("analytics.reports:view") ? REPORTS.length - runnable.length : REPORTS.length;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Reports & analytics" description={`${ctx.branch.name} · figures come from each module, not a copy of them`} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {kpis.map((k) => {
          const body = (
            <>
              <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{k.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{k.value}</p>
              {k.hint ? <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{k.hint}</p> : null}
            </>
          );
          return (
            <div key={k.label} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              {k.href ? (
                <Link href={withBranch(k.href, ctx)} className="block transition-opacity hover:opacity-70">
                  {body}
                </Link>
              ) : (
                body
              )}
            </div>
          );
        })}
      </div>

      <Card title="Reports">
        {runnable.length === 0 ? (
          <EmptyState>
            No reports match the permissions you hold. Each report requires the same permission as the records it reads.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {runnable.map((r) => (
              <li key={r.key} className="py-3">
                <Link href={withBranch(`/analytics/${r.key}`, ctx)} className="text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                  {r.name}
                </Link>
                <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{r.description}</p>
                <p className="mt-0.5 text-xs italic text-zinc-400 dark:text-zinc-600">{r.answers}</p>
              </li>
            ))}
          </ul>
        )}
        {withheld > 0 ? (
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            {withheld} further report{withheld === 1 ? " is" : "s are"} hidden because you don&apos;t hold the permission for the records
            {withheld === 1 ? " it reads" : " they read"}.
          </p>
        ) : null}
      </Card>

      <Card title="How this is built">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
          <li>Analytics owns no tables. Every figure is computed from the module that owns it, using that module&apos;s own helpers.</li>
          <li>A report is a fixed declaration — one permission, one column set, one query. Nothing about its shape comes from the URL.</li>
          <li>
            The staff directory report has no pay column on purpose: it requires <code className="text-xs">sis.staff:view</code>, which is
            not <code className="text-xs">hr.compensation:view</code>.
          </li>
        </ul>
      </Card>
    </div>
  );
}
