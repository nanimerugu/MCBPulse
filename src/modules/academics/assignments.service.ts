import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * SubjectAssignment: which staff member teaches which subject to which
 * section. Besides driving the timetable and the teacher dashboard, this is
 * the record the attribute policy scopes teachers by (scope.ts) — so
 * assigning a teacher here is also what lets them see those students.
 */

export async function listAssignments(sectionId: string, organizationId: string) {
  return db.subjectAssignment.findMany({
    where: { sectionId, section: { grade: { branch: { organizationId } } } },
    include: { subject: true, staff: { include: { user: { select: { name: true, email: true } } } } },
    orderBy: { subject: { name: "asc" } },
  });
}

/** Staff who can be put in front of a class: this branch's plus org-wide staff. */
export async function listTeachingStaff(organizationId: string, branchId: string) {
  return db.staff.findMany({
    where: { organizationId, deletedAt: null, exitDate: null, OR: [{ branchId }, { branchId: null }] },
    include: { user: { select: { name: true } } },
    orderBy: { employeeCode: "asc" },
  });
}

async function requireSectionInBranch(sectionId: string, branchId: string) {
  const section = await db.section.findFirst({
    where: { id: sectionId, deletedAt: null, grade: { branchId, deletedAt: null }, academicYear: { isCurrent: true, deletedAt: null } },
    include: { grade: true },
  });
  if (!section) throw new SisError("That section isn't in this branch's current academic year");
  return section;
}

export async function setAssignment(
  input: { sectionId: string; subjectId: string; staffId: string },
  branchId: string,
  actor: Actor,
) {
  const [section, subject, staff] = await Promise.all([
    requireSectionInBranch(input.sectionId, branchId),
    db.subject.findFirst({ where: { id: input.subjectId, organizationId: actor.organizationId, deletedAt: null } }),
    db.staff.findFirst({ where: { id: input.staffId, organizationId: actor.organizationId, deletedAt: null }, include: { user: { select: { name: true } } } }),
  ]);
  if (!subject) throw new SisError("Subject not found");
  if (!staff) throw new SisError("Staff member not found");

  const before = await db.subjectAssignment.findUnique({
    where: { sectionId_subjectId: { sectionId: input.sectionId, subjectId: input.subjectId } },
    include: { staff: { include: { user: { select: { name: true } } } } },
  });

  const assignment = await db.subjectAssignment.upsert({
    where: { sectionId_subjectId: { sectionId: input.sectionId, subjectId: input.subjectId } },
    create: { sectionId: input.sectionId, subjectId: input.subjectId, staffId: input.staffId },
    update: { staffId: input.staffId },
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: before ? "assignment.changed" : "assignment.created",
    resourceType: "section",
    resourceId: section.id,
    before: before ? { subject: subject.code, teacher: before.staff.user.name } : undefined,
    after: { section: `${section.grade.name} / ${section.name}`, subject: subject.code, teacher: staff.user.name },
  });

  return assignment;
}

export async function removeAssignment(id: string, actor: Actor) {
  const assignment = await db.subjectAssignment.findFirst({
    where: { id, section: { grade: { branch: { organizationId: actor.organizationId } } } },
    include: { subject: true, staff: { include: { user: { select: { name: true } } } }, section: { include: { grade: true } } },
  });
  if (!assignment) throw new SisError("Assignment not found");

  await db.subjectAssignment.delete({ where: { id } });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "assignment.removed",
    resourceType: "section",
    resourceId: assignment.sectionId,
    before: { section: `${assignment.section.grade.name} / ${assignment.section.name}`, subject: assignment.subject.code, teacher: assignment.staff.user.name },
  });
}
