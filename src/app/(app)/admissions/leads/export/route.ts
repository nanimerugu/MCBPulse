import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { loadAdmissionsAccess } from "@/modules/sis/access";
import { toCsv } from "@/modules/sis/csv";

/** Every lead in the active branch as CSV. Audited — it's a bulk pull of contact data. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await loadAdmissionsAccess(url.searchParams.get("branch") ?? undefined, "admissions.leads", "export");
  if (!result.ok) return new Response("Forbidden", { status: 403 });
  const { viewer, ctx } = result.access;

  const leads = await db.lead.findMany({
    where: { organizationId: ctx.organizationId, branchId: ctx.branch.id, deletedAt: null },
    include: { source: true, campaign: true, applications: { select: { status: true, gradeAppliedFor: true } } },
    orderBy: { createdAt: "desc" },
  });
  const counselorIds = [...new Set(leads.map((l) => l.assignedCounselorUserId).filter((x): x is string => !!x))];
  const users = counselorIds.length ? await db.user.findMany({ where: { id: { in: counselorIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  const rows = leads.map((l) => [
    l.name,
    l.phone,
    l.email ?? "",
    l.stage,
    l.source?.name ?? "",
    l.campaign?.name ?? "",
    l.assignedCounselorUserId ? nameOf.get(l.assignedCounselorUserId) ?? "" : "",
    l.nextFollowUpAt?.toISOString().slice(0, 10) ?? "",
    l.applications.map((a) => `${a.gradeAppliedFor}:${a.status}`).join("; "),
    l.createdAt.toISOString().slice(0, 10),
  ]);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorUserId: viewer.userId,
    action: "leads.exported",
    resourceType: "lead_export",
    after: { branchId: ctx.branch.id, count: leads.length },
  });

  return new Response(toCsv([["name", "phone", "email", "stage", "source", "campaign", "counselor", "next_follow_up", "applications", "created"], ...rows]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${ctx.branch.code.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
