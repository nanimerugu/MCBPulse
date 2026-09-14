import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * Departments and positions (blueprint 10.7: "departments, positions,
 * employee records"). Both are organization-level, not branch-level — a
 * trust's "Mathematics" department spans its campuses, and a position title
 * means the same thing everywhere. Staff are the branch-level thing that
 * points at them.
 */

export async function listDepartments(organizationId: string) {
  return db.department.findMany({
    where: { organizationId, deletedAt: null },
    include: {
      positions: { where: { deletedAt: null }, orderBy: { title: "asc" }, include: { _count: { select: { staff: true } } } },
      _count: { select: { staff: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function listPositions(organizationId: string) {
  return db.position.findMany({
    where: { organizationId, deletedAt: null },
    include: { department: true },
    orderBy: { title: "asc" },
  });
}

export async function createDepartment(name: string, actor: Actor) {
  const clash = await db.department.findFirst({ where: { organizationId: actor.organizationId, name, deletedAt: null } });
  if (clash) throw new SisError(`A department called "${name}" already exists`);

  const department = await db.department.create({ data: { organizationId: actor.organizationId, name } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "department.created",
    resourceType: "department",
    resourceId: department.id,
    after: { name },
  });
  return department;
}

export async function createPosition(input: { title: string; departmentId?: string }, actor: Actor) {
  const clash = await db.position.findFirst({ where: { organizationId: actor.organizationId, title: input.title, deletedAt: null } });
  if (clash) throw new SisError(`A position called "${input.title}" already exists`);

  if (input.departmentId) {
    const dept = await db.department.findFirst({ where: { id: input.departmentId, organizationId: actor.organizationId, deletedAt: null } });
    if (!dept) throw new SisError("Department not found");
  }

  const position = await db.position.create({
    data: { organizationId: actor.organizationId, title: input.title, departmentId: input.departmentId ?? null },
  });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "position.created",
    resourceType: "position",
    resourceId: position.id,
    after: { title: input.title, departmentId: input.departmentId ?? null },
  });
  return position;
}

/**
 * Both ids are validated against the caller's own organization before the
 * write — the form supplies them, so an id from another tenant must not be
 * able to ride in on a hidden field.
 */
export async function assignStaffToOrgUnit(
  staffId: string,
  input: { departmentId: string | null; positionId: string | null },
  actor: Actor,
) {
  const staff = await db.staff.findFirst({
    where: { id: staffId, organizationId: actor.organizationId, deletedAt: null },
    include: { department: true, position: true },
  });
  if (!staff) throw new SisError("Staff member not found");

  if (input.departmentId) {
    const dept = await db.department.findFirst({ where: { id: input.departmentId, organizationId: actor.organizationId, deletedAt: null } });
    if (!dept) throw new SisError("Department not found");
  }
  if (input.positionId) {
    const pos = await db.position.findFirst({ where: { id: input.positionId, organizationId: actor.organizationId, deletedAt: null } });
    if (!pos) throw new SisError("Position not found");
  }

  await db.staff.update({ where: { id: staffId }, data: { departmentId: input.departmentId, positionId: input.positionId } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "staff.org_unit_changed",
    resourceType: "staff",
    resourceId: staffId,
    before: { department: staff.department?.name ?? null, position: staff.position?.title ?? null },
    after: { departmentId: input.departmentId, positionId: input.positionId },
  });
}
