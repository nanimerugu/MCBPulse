import "server-only";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { StaffInput } from "@/modules/sis/schemas";
import { SisError, type Actor } from "@/modules/sis/students.service";

export async function listStaff(organizationId: string, branchId: string) {
  return db.staff.findMany({
    // Org-wide staff (branchId null) belong to every branch's roster.
    where: { organizationId, deletedAt: null, OR: [{ branchId }, { branchId: null }] },
    include: {
      user: { select: { email: true, status: true, lastLoginAt: true } },
      department: true,
      position: true,
    },
    orderBy: { employeeCode: "asc" },
  });
}

/** System roles a staff member can be given at creation. Parent/student/alumni are not staff. */
export async function listStaffRoles() {
  return db.role.findMany({
    where: {
      organizationId: null,
      isSystem: true,
      deletedAt: null,
      key: { notIn: ["platform_admin", "parent", "student", "alumni", "visitor_security"] },
    },
    orderBy: { name: "asc" },
    select: { id: true, key: true, name: true },
  });
}

/**
 * Creating staff means three rows in one transaction: the User (login), the
 * Staff record, and a RoleAssignment scoped to this org + branch. If the
 * email already has a User with no staff profile (e.g. an existing parent
 * who is also joining as a teacher), that User is reused rather than
 * rejected — one person, one login (blueprint section 8: never duplicate
 * identity across modules).
 */
export async function createStaff(input: StaffInput, scope: { branchId: string }, actor: Actor) {
  const role = await db.role.findFirst({ where: { organizationId: null, key: input.roleKey, isSystem: true, deletedAt: null } });
  if (!role) throw new SisError("Unknown role");
  if (role.key === "platform_admin") throw new SisError("Platform Admin can't be granted from the staff screen");

  const codeClash = await db.staff.findFirst({ where: { organizationId: actor.organizationId, employeeCode: input.employeeCode } });
  if (codeClash) throw new SisError(`Employee code ${input.employeeCode} is already in use`);

  const passwordHash = input.initialPassword ? await bcrypt.hash(input.initialPassword, 12) : null;

  const result = await db.$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { email: input.email }, include: { staffProfile: true } });
    let userCreated = false;

    if (user?.staffProfile) {
      throw new SisError(`${input.email} already has a staff record`);
    }
    if (!user) {
      user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          status: passwordHash ? "ACTIVE" : "INVITED",
        },
        include: { staffProfile: true },
      });
      userCreated = true;
    } else if (passwordHash && !user.passwordHash) {
      // Existing login with no password yet (invited, never activated).
      user = await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, status: "ACTIVE" },
        include: { staffProfile: true },
      });
    }

    const staff = await tx.staff.create({
      data: {
        organizationId: actor.organizationId,
        branchId: scope.branchId,
        userId: user.id,
        employeeCode: input.employeeCode,
        designation: input.designation,
        joinDate: new Date(`${input.joinDate}T00:00:00.000Z`),
      },
    });

    const assignment = await tx.roleAssignment.create({
      data: { userId: user.id, roleId: role.id, organizationId: actor.organizationId, branchId: scope.branchId },
    });

    return { user, staff, assignment, userCreated };
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "staff.created",
    resourceType: "staff",
    resourceId: result.staff.id,
    after: {
      email: result.user.email,
      employeeCode: result.staff.employeeCode,
      designation: result.staff.designation,
      role: role.key,
      branchId: scope.branchId,
      userCreated: result.userCreated,
      loginEnabled: Boolean(passwordHash) || result.user.status === "ACTIVE",
    },
  });
  // A role grant is a permission change — the blueprint (section 18) wants
  // those individually auditable, not buried inside "staff.created".
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "role_assignment.created",
    resourceType: "role_assignment",
    resourceId: result.assignment.id,
    after: { userId: result.user.id, role: role.key, branchId: scope.branchId },
  });

  return result.staff;
}
