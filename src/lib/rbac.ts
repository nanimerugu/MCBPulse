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
 * authorize(user, action, resource) -> tenant_scope -> role_permission ->
 * attribute_policy -> approval_policy -> allow/deny  (blueprint section 5).
 *
 * Phase 0 implements the first two stages:
 *   1. tenant_scope  — only role assignments for this exact organization,
 *      and (if the assignment is branch/year-scoped) this branch/year, are
 *      considered. A branch-scoped assignment never grants access outside
 *      that branch; an org-wide assignment (branchId = null) grants access
 *      to every branch in the organization.
 *   2. role_permission — does any matching assignment's role carry the
 *      requested module:action permission?
 *
 * Attribute policies (e.g. "only your own assigned classes") and approval
 * policies arrive with the modules that need them — a Teacher's "only
 * assigned classes" rule belongs to Phase 2 Academics, not here.
 */
export async function authorize(
  userId: string,
  module: string,
  action: Action,
  scope: TenantScope,
): Promise<boolean> {
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

  return assignments.some((assignment) => {
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
}

/** Throws ForbiddenError instead of returning false — for route/action guards. */
export async function requirePermission(
  userId: string,
  module: string,
  action: Action,
  scope: TenantScope,
): Promise<void> {
  const allowed = await authorize(userId, module, action, scope);
  if (!allowed) {
    throw new ForbiddenError(`Missing permission ${permissionKey(module, action)}`);
  }
}
