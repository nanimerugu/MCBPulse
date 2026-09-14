import "server-only";
import { db } from "@/lib/db";
import { SELF_SCOPED_ROLE_KEYS } from "@/lib/rbac";

/**
 * Where a user belongs after signing in.
 *
 * A parent landing on /dashboard would see a staff shell full of modules
 * that all refuse them — technically safe (the gate fails closed) but a
 * confusing wall of "you don't have permission". Routing on the role they
 * actually hold is the difference between a product and a permission error.
 *
 * A user with BOTH a staff role and a self-scoped one (a teacher whose child
 * attends the school) goes to the staff app, because that is the surface
 * with more on it; the portal stays reachable at /portal.
 */
export async function landingPathFor(userId: string): Promise<"/dashboard" | "/portal"> {
  const assignments = await db.roleAssignment.findMany({
    where: { userId, revokedAt: null },
    select: { role: { select: { key: true } } },
  });
  if (assignments.length === 0) return "/dashboard";
  const everyRoleIsSelfScoped = assignments.every((a) => SELF_SCOPED_ROLE_KEYS.has(a.role.key));
  return everyRoleIsSelfScoped ? "/portal" : "/dashboard";
}
