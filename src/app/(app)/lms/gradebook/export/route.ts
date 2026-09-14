import { recordAuditEvent } from "@/lib/audit";
import { loadLmsAccess } from "@/modules/sis/access";
import { getSectionScope, sectionInScope } from "@/modules/academics/scope";
import { getGradebook } from "@/modules/lms/assignments.service";
import { formatPercentage } from "@/modules/lms/grading";
import { toCsv } from "@/modules/sis/csv";
import { db } from "@/lib/db";

/** One section's gradebook as CSV. Audited: it's a bulk pull of marks. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await loadLmsAccess(url.searchParams.get("branch") ?? undefined, "lms.grades", "export");
  if (!result.ok) return new Response("Forbidden", { status: 403 });
  const { viewer, ctx } = result.access;

  const sectionId = url.searchParams.get("section");
  if (!sectionId) return new Response("Missing section", { status: 400 });

  const scope = await getSectionScope(result.access);
  if (!sectionInScope(scope, sectionId)) return new Response("Forbidden", { status: 403 });

  const section = await db.section.findFirst({
    where: { id: sectionId, grade: { branchId: ctx.branch.id } },
    include: { grade: true },
  });
  if (!section) return new Response("Not found", { status: 404 });

  const book = await getGradebook(sectionId, ctx.organizationId);
  const header = ["admission_number", "student", ...book.assignments.map((a) => `${a.title} (/${a.maxMarks})`), "average"];
  const rows = book.rows.map((r) => [
    r.admissionNumber,
    r.name,
    ...r.cells.map((c) => (c.marksAwarded !== null ? String(c.marksAwarded) : "")),
    formatPercentage(r.totals.percentage),
  ]);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorUserId: viewer.userId,
    action: "gradebook.exported",
    resourceType: "section",
    resourceId: sectionId,
    after: { section: `${section.grade.name} / ${section.name}`, students: book.rows.length, assignments: book.assignments.length },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const tag = `${section.grade.name}-${section.name}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new Response(toCsv([header, ...rows]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gradebook-${tag}-${stamp}.csv"`,
    },
  });
}
