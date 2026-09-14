import "server-only";
import { db } from "@/lib/db";
import type { Action } from "@/lib/permissions";
import { permissionKey } from "@/lib/permissions";

export interface TenantScope {
  organizationId: string;
  branchId?: string | null;
  academicYearId?: string | null;
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Roles whose grants are limited to the sections their holder teaches. When
 * EVERY role granting a permission is one of these, the decision comes back
 * `sectionScoped: true` and the module must filter by the holder's
 * SubjectAssignments (see src/modules/academics/scope.ts). One broad role
 * (a Principal who also teaches) lifts the restriction.
 */
export const SECTION_SCOPED_ROLE_KEYS: ReadonlySet<string> = new Set(["teacher", "class_teacher"]);

export interface AccessDecision {
  allowed: boolean;
  /** True only when allowed AND every granting role is section-scoped. */
  sectionScoped: boolean;
}

/**
 * authorize(user, action, resource) -> tenant_scope -> role_permission ->
 * attribute_policy -> approval_policy -> allow/deny  (blueprint section 5).
 *
 *   1. tenant_scope  — only role assignments for this exact organization,
 *      and (if the assignment is branch/year-scoped) this branch/year, are
 *      considered. A branch-scoped assignment never grants access outside
 *      that branch; an org-wide assignment (branchId = null) grants access
 *      to every branch in the organization.
 *   2. role_permission — does any matching assignment's role carry the
 *      requested module:action permission?
 *   3. attribute_policy — reported, not enforced, here: `sectionScoped`
 *      tells the caller the grant only reaches the holder's own sections.
 *      Enforcement needs the resource (which section is this student in?),
 *      so it lives in the module, next to the query it filters.
 *
 * Approval policies arrive with the shared workflow engine (section 12).
 */
export async function resolveAccess(
  userId: string,
  module: string,
  action: Action,
  scope: TenantScope,
): Promise<AccessDecision> {
  const key = permissionKey(module, action);

  const assignments = await db.roleAssignment.findMany({
    where: {
      userId,
      organizationId: scope.organizationId,
      revokedAt: null,
    },
    include: {
      role: { include: { rolePermissions: { include: { permission: true } } } },
    },
  });

  const granting = assignments.filter((assignment) => {
    // null on the assignment means "every branch/year in this org"; a
    // non-null value must match scope exactly. If the resource being
    // checked has no branch/year of its own (scope field is absent), a
    // branch/year-limited assignment does NOT count — only an org-wide one
    // does. This is what makes a branch-scoped assignment unable to reach
    // an org-level resource, and vice versa.
    if (assignment.branchId && assignment.branchId !== scope.branchId) return false;
    if (assignment.academicYearId && assignment.academicYearId !== scope.academicYearId) return false;
    return assignment.role.rolePermissions.some((rp) => rp.permission.key === key);
  });

  if (granting.length === 0) return { allowed: false, sectionScoped: false };
  return {
    allowed: true,
    sectionScoped: granting.every((a) => SECTION_SCOPED_ROLE_KEYS.has(a.role.key)),
  };
}

export async function authorize(
  userId: string,
  module: string,
  action: Action,
  scope: TenantScope,
): Promise<boolean> {
  return (await resolveAccess(userId, module, action, scope)).allowed;
}

/**
 * Every permission key the user holds anywhere in this organization, as one
 * query. For deciding what to *show* — navigation, mainly — where asking
 * `authorize()` per module would mean a query per item on every render.
 * Not a substitute for authorize(): it ignores branch/year scope, so the
 * page itself still checks properly before showing anything real.
 */
export async function heldPermissionKeys(userId: string, organizationId: string): Promise<Set<string>> {
  const assignments = await db.roleAssignment.findMany({
    where: { userId, organizationId, revokedAt: null },
    select: { role: { select: { rolePermissions: { select: { permission: { select: { key: true } } } } } } },
  });
  const keys = new Set<string>();
  for (const a of assignments) for (const rp of a.role.rolePermissions) keys.add(rp.permission.key);
  return keys;
}

/** Throws ForbiddenError instead of returning false — for route/action guards. */
export async function requirePermission(
  userId: string,
  module: string,
  action: Action,
  scope: TenantScope,
): Promise<AccessDecision> {
  const decision = await resolveAccess(userId, module, action, scope);
  if (!decision.allowed) {
    throw new ForbiddenError(`Missing permission ${permissionKey(module, action)}`);
  }
  return decision;
}
