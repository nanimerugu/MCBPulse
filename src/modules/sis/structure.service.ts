import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * Grades and sections for one branch. Grades persist across years; sections
 * are per academic year (Grade 5 has sections A/B in 2026-27 and maybe A/B/C
 * in 2027-28). That split is what lets promotion move students into next
 * year's sections without rewriting this year's history.
 */

export async function listStructure(branchId: string, academicYearId: string | null) {
  return db.grade.findMany({
    where: { branchId, deletedAt: null },
    include: {
      sections: {
        where: { deletedAt: null, ...(academicYearId ? { academicYearId } : { id: "__none__" }) },
        include: { _count: { select: { students: { where: { deletedAt: null } } } } },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { sequence: "asc" },
  });
}

export async function createGrade(branchId: string, input: { name: string; sequence: number }, actor: Actor) {
  const branch = await db.branch.findFirst({ where: { id: branchId, organizationId: actor.organizationId, deletedAt: null } });
  if (!branch) throw new SisError("Branch not found");

  const clash = await db.grade.findFirst({ where: { branchId, name: input.name, deletedAt: null } });
  if (clash) throw new SisError(`Grade "${input.name}" already exists in this branch`);

  const grade = await db.grade.create({ data: { branchId, name: input.name, sequence: input.sequence } });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "grade.created",
    resourceType: "grade",
    resourceId: grade.id,
    after: { name: grade.name, sequence: grade.sequence, branchId },
  });

  return grade;
}

export async function createSection(
  input: { gradeId: string; academicYearId: string; name: string; capacity?: number },
  actor: Actor,
) {
  const grade = await db.grade.findFirst({
    where: { id: input.gradeId, deletedAt: null, branch: { organizationId: actor.organizationId } },
    include: { branch: true },
  });
  if (!grade) throw new SisError("Grade not found");

  const year = await db.academicYear.findFirst({ where: { id: input.academicYearId, branchId: grade.branchId, deletedAt: null } });
  if (!year) throw new SisError("Academic year not found for this branch");

  const clash = await db.section.findFirst({
    where: { gradeId: input.gradeId, academicYearId: input.academicYearId, name: input.name, deletedAt: null },
  });
  if (clash) throw new SisError(`Section "${input.name}" already exists in ${grade.name} for ${year.name}`);

  const section = await db.section.create({
    data: { gradeId: input.gradeId, academicYearId: input.academicYearId, name: input.name, capacity: input.capacity ?? null },
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "section.created",
    resourceType: "section",
    resourceId: section.id,
    after: { grade: grade.name, name: section.name, academicYear: year.name, capacity: section.capacity },
  });

  return section;
}
