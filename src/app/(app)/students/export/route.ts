import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { loadSisAccess } from "@/modules/sis/access";
import { toCsv } from "@/modules/sis/csv";

/**
 * Every student in the active branch as CSV. Exports are audited (blueprint
 * section 18: "audit all ... exports") — a bulk pull of PII is exactly the
 * kind of action someone should be able to ask "who did that?" about.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await loadSisAccess(url.searchParams.get("branch") ?? undefined, "sis.students", "export");
  if (!result.ok) return new Response("Forbidden", { status: 403 });
  const { viewer, ctx } = result.access;

  const students = await db.student.findMany({
    where: { organizationId: ctx.organizationId, branchId: ctx.branch.id, deletedAt: null },
    include: {
      currentSection: { include: { grade: true } },
      guardianLinks: { include: { guardian: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1 },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  const header = [
    "admission_number",
    "first_name",
    "last_name",
    "date_of_birth",
    "gender",
    "status",
    "grade",
    "section",
    "admission_date",
    "guardian_name",
    "guardian_phone",
    "guardian_email",
    "guardian_relationship",
    "city",
    "blood_group",
  ];
  const rows = students.map((s) => {
    const g = s.guardianLinks[0];
    return [
      s.admissionNumber,
      s.firstName,
      s.lastName,
      s.dateOfBirth?.toISOString().slice(0, 10) ?? "",
      s.gender ?? "",
      s.status,
      s.currentSection?.grade.name ?? "",
      s.currentSection?.name ?? "",
      s.admissionDate?.toISOString().slice(0, 10) ?? "",
      g ? `${g.guardian.firstName} ${g.guardian.lastName}`.trim() : "",
      g?.guardian.phone ?? "",
      g?.guardian.email ?? "",
      g?.relationship ?? "",
      s.city ?? "",
      s.bloodGroup ?? "",
    ];
  });

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorUserId: viewer.userId,
    action: "students.exported",
    resourceType: "student_export",
    after: { branchId: ctx.branch.id, count: students.length },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(toCsv([header, ...rows]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="students-${ctx.branch.code.toLowerCase()}-${stamp}.csv"`,
    },
  });
}
