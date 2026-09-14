import { notFound } from "next/navigation";
import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { Card, EmptyState, ErrorBanner, Field, Input, LinkButton, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadAnalyticsAccess, param } from "@/modules/sis/access";
import { parseRange, reportFor } from "@/modules/analytics/reports";
import { runReport } from "@/modules/analytics/analytics.service";

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ reportKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ reportKey }, sp] = await Promise.all([params, searchParams]);
  const report = reportFor(reportKey);
  if (!report) notFound();

  const result = await loadAnalyticsAccess(param(sp, "branch"), "analytics.reports", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title={report.name} />
        <AccessDenied result={result} permission="analytics.reports:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const scope = { organizationId: ctx.organizationId, branchId: ctx.branch.id };

  // The second gate, and the one that matters: opening the catalogue is not
  // permission to read the records. A report is refused unless the viewer
  // holds the permission of the module it reads.
  const [permitted, canExport] = await Promise.all([
    authorize(viewer.userId, report.requires.module, report.requires.action, scope),
    authorize(viewer.userId, "analytics.reports", "export", scope),
  ]);
  if (!permitted) {
    return (
      <>
        <PageHeader title={report.name} actions={<LinkButton href={withBranch("/analytics", ctx)}>All reports</LinkButton>} />
        <EmptyState>
          This report reads records guarded by <code className="text-xs">{report.requires.module}:{report.requires.action}</code>, which you
          don&apos;t hold.
        </EmptyState>
      </>
    );
  }

  const parsed = parseRange(param(sp, "from"), param(sp, "to"));
  const range = parsed.ok ? parsed.range : { from: "", to: "" };
  const data = parsed.ok ? await runReport(report.key, scope, range) : null;

  const exportHref = withBranch(`/analytics/${report.key}/export`, ctx) + (report.params === "date_range" ? `&from=${range.from}&to=${range.to}` : "");

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={report.name}
        description={report.description}
        actions={
          <>
            {canExport && data && data.rows.length > 0 ? <LinkButton href={exportHref}>Download CSV</LinkButton> : null}
            <LinkButton href={withBranch("/analytics", ctx)}>All reports</LinkButton>
          </>
        }
      />

      {report.params === "date_range" ? (
        <Card title="Date range">
          <form className="flex flex-wrap items-end gap-3" action={withBranch(`/analytics/${report.key}`, ctx)}>
            <input type="hidden" name="branch" value={ctx.branch.id} />
            <Field label="From" htmlFor="rp-from">
              <Input id="rp-from" name="from" type="date" defaultValue={range.from} />
            </Field>
            <Field label="To" htmlFor="rp-to">
              <Input id="rp-to" name="to" type="date" defaultValue={range.to} />
            </Field>
            <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3.5 py-2 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-900">
              Apply
            </button>
          </form>
          {!parsed.ok ? (
            <div className="mt-3">
              <ErrorBanner message={parsed.message} />
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card title={data ? `${data.rows.length} row${data.rows.length === 1 ? "" : "s"}` : "No data"}>
        {!data || data.rows.length === 0 ? (
          <EmptyState>Nothing to report for this selection.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <tr>
                  {data.header.map((h) => (
                    <th key={h} className="py-2 pr-4 font-medium">
                      {h.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {data.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className="py-2 pr-4 tabular-nums">
                        {cell || "—"}
                      </td>
                    ))}
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
