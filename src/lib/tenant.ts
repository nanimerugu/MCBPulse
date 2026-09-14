import "server-only";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { sessionPredatesPasswordChange } from "@/lib/auth-tokens";

/**
 * The signed-in user plus every (org, branch?, year?) they currently hold a
 * role in. Phase 0 doesn't yet have a tenant switcher UI, so `organization`
 * is just the first non-revoked assignment's org — good enough for a person
 * who belongs to one school, which is everyone except a Platform Admin
 * auditing multiple tenants. A real switcher (persisted "active org" choice)
 * is a Phase 1 concern once there is more than one screen to switch between.
 */
export interface ViewerContext {
  userId: string;
  email: string;
  name: string;
  assignments: Awaited<ReturnType<typeof loadAssignments>>;
  organizationId: string | null;
}

async function loadAssignments(userId: string) {
  return db.roleAssignment.findMany({
    where: { userId, revokedAt: null },
    include: { organization: true, branch: true, academicYear: true, role: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Returns null for no session AND for a session whose user no longer exists
 * or is no longer ACTIVE. The JWT cookie is only proof that someone signed
 * in once; whether they're still allowed in is a database question, asked
 * here on every request. (Found the hard way: a re-seeded database left a
 * browser holding a perfectly valid token for a user id that had ceased to
 * exist — the same shape as a disabled employee keeping access.)
 */
export async function getViewerContext(): Promise<ViewerContext | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await db.user.findFirst({
    where: { id: session.user.id, status: "ACTIVE", deletedAt: null },
    select: { id: true, email: true, name: true, passwordChangedAt: true },
  });
  if (!user) return null;
  // A reset exists to lock out whoever knew the old password. Their cookie
  // was signed before the change, so it stops working here.
  if (sessionPredatesPasswordChange(session.authTime, user.passwordChangedAt)) return null;

  const assignments = await loadAssignments(user.id);

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    assignments,
    organizationId: assignments[0]?.organizationId ?? null,
  };
}
