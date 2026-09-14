import { recordAuditEvent } from "@/lib/audit";
import { authorize } from "@/lib/rbac";
import { loadAnalyticsAccess } from "@/modules/sis/access";
import { parseRange, reportFor } from "@/modules/analytics/reports";
import { runReport } from "@/modules/analytics/analytics.service";
import { toCsv } from "@/modules/sis/csv";

/**
 * A report as CSV. Both gates apply: `analytics.reports:export` to download
 * anything at all, AND the report's own module permission, checked here
 * rather than inherited from the page — a route is reachable without ever
 * loading the page that links to it.
 *
 * Audited, because a report export is the single largest bulk read the
 * product offers.
 */
export async function GET(request: Request, { params }: { params: Promise<{ reportKey: string }> }) {
  const { reportKey } = await params;
  const report = reportFor(reportKey);
  if (!report) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const result = await loadAnalyticsAccess(url.searchParams.get("branch") ?? undefined, "analytics.reports", "export");
  if (!result.ok) return new Response("Forbidden", { status: 403 });
  const { viewer, ctx } = result.access;
  const scope = { organizationId: ctx.organizationId, branchId: ctx.branch.id };

  if (!(await authorize(viewer.userId, report.requires.module, report.requires.action, scope))) {
    return new Response("Forbidden", { status: 403 });
  }

  const parsed = parseRange(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);
  if (!parsed.ok) return new Response(parsed.message, { status: 400 });

  const data = await runReport(report.key, scope, parsed.range);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorUserId: viewer.userId,
    action: "report.exported",
    resourceType: "report",
    resourceId: report.key,
    after: { report: report.name, rows: data.rows.length, from: parsed.range.from, to: parsed.range.to },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(toCsv([data.header, ...data.rows]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${report.key}-${stamp}.csv"`,
    },
  });
}
