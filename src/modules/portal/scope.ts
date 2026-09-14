import "server-only";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getViewerContext, type ViewerContext } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { SELF_SCOPED_ROLE_KEYS } from "@/lib/rbac";

export const PORTAL_FLAG = "phase9.portal";

/**
 * "Own records only" — the attribute policy Phases 5, 7 and 8 each deferred.
 *
 * The staff side asks "may this user do X?" and filters afterwards. The
 * portal inverts it: the viewer's identity decides the row set FIRST, and
 * nothing outside that set is reachable by any route. There is no branch
 * picker, no student picker, no id in a query string that widens anything —
 * every portal query is built from `studentIds` resolved here.
 *
 * That inversion is deliberate. A filter you must remember to apply is a
 * filter you will one day forget; a scope that produces the id list up front
 * fails closed, because an empty list returns nothing rather than everything.
 */

export type PortalKind = "parent" | "student" | "driver";

export interface PortalScope {
  viewer: ViewerContext;
  kind: PortalKind;
  organizationId: string;
  /**
   * Exactly the students this viewer may see.
   *
   * Non-empty for a parent or student — a login with nothing attached is a
   * broken account and is refused. A DRIVER may legitimately have an empty
   * list: a bus with no riders allocated yet is a normal state, not a broken
   * account, and shows an empty manifest rather than an error.
   */
  studentIds: string[];
  /** Set for a parent: their Guardian row. */
  guardianId?: string;
  /** Set for a student: their own Student row. */
  selfStudentId?: string;
  /** Set for a driver: their Staff row. */
  staffId?: string;
}

export type PortalScopeResult =
  | { ok: true; scope: PortalScope }
  | { ok: false; reason: "not_a_portal_user" | "feature_disabled" | "nothing_linked" | "not_your_child" | "no_vehicle"; viewer: ViewerContext };

/**
 * Which self-scoped roles does this user hold, in which organization? A user
 * can be a parent at one organization and nothing at another, so the role
 * assignment carries the tenancy as it does everywhere else.
 */
async function selfScopedAssignment(userId: string) {
  const assignments = await db.roleAssignment.findMany({
    where: { userId, revokedAt: null },
    include: { role: { select: { key: true } } },
    orderBy: { createdAt: "asc" },
  });
  return assignments.find((a) => SELF_SCOPED_ROLE_KEYS.has(a.role.key)) ?? null;
}

export async function getPortalScope(): Promise<PortalScopeResult> {
  const viewer = await getViewerContext();
  if (!viewer) redirect("/login");

  const assignment = await selfScopedAssignment(viewer.userId);
  if (!assignment) return { ok: false, reason: "not_a_portal_user", viewer };

  if (!(await isFeatureEnabled(PORTAL_FLAG, assignment.organizationId))) {
    return { ok: false, reason: "feature_disabled", viewer };
  }

  const organizationId = assignment.organizationId;
  const kind = assignment.role.key as PortalKind;

  if (kind === "parent") {
    const guardian = await db.guardian.findFirst({
      where: { userId: viewer.userId, deletedAt: null },
      include: {
        studentLinks: {
          where: { student: { organizationId, deletedAt: null } },
          select: { studentId: true },
        },
      },
    });
    // A login with no guardian record, or a guardian with no children at
    // this organization, gets nothing — not "everything".
    if (!guardian || guardian.studentLinks.length === 0) return { ok: false, reason: "nothing_linked", viewer };
    return {
      ok: true,
      scope: { viewer, kind, organizationId, guardianId: guardian.id, studentIds: guardian.studentLinks.map((l) => l.studentId) },
    };
  }

  if (kind === "student") {
    const student = await db.student.findFirst({ where: { userId: viewer.userId, organizationId, deletedAt: null } });
    if (!student) return { ok: false, reason: "nothing_linked", viewer };
    return { ok: true, scope: { viewer, kind, organizationId, selfStudentId: student.id, studentIds: [student.id] } };
  }

  // Driver: the students riding the routes their vehicle serves. A driver
  // sees a manifest, not a student record — the portal shows name, stop and
  // section, and nothing academic, medical or financial.
  const staff = await db.staff.findFirst({
    where: { userId: viewer.userId, organizationId, deletedAt: null, exitDate: null },
    include: { vehiclesDriven: { where: { deletedAt: null }, select: { id: true } } },
  });
  // No vehicle assigned IS a broken driver account. An assigned vehicle with
  // nobody on it is not — that is just a quiet morning, and the manifest
  // should say "nobody is allocated" rather than "your account is broken".
  if (!staff || staff.vehiclesDriven.length === 0) return { ok: false, reason: "no_vehicle", viewer };

  const riders = await db.studentTransport.findMany({
    where: { route: { vehicleId: { in: staff.vehiclesDriven.map((v) => v.id) }, deletedAt: null } },
    select: { studentId: true },
  });

  return { ok: true, scope: { viewer, kind, organizationId, staffId: staff.id, studentIds: riders.map((r) => r.studentId) } };
}

/**
 * Narrow to one child. A parent with two children can switch between them,
 * and this is the ONLY way a student id from the URL enters a portal query —
 * it must already be in the scope's list, so a guessed or edited id resolves
 * to null rather than to somebody else's child.
 */
export function studentInScope(scope: PortalScope, studentId: string | undefined): string | null {
  if (!studentId) return scope.studentIds[0] ?? null;
  return scope.studentIds.includes(studentId) ? studentId : null;
}
