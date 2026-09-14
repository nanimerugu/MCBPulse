import "server-only";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

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

export async function getViewerContext(): Promise<ViewerContext | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const assignments = await loadAssignments(session.user.id);

  return {
    userId: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? session.user.email ?? "Unknown",
    assignments,
    organizationId: assignments[0]?.organizationId ?? null,
  };
}
