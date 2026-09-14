import "server-only";
import { db } from "@/lib/db";
import { getPortalScope, studentInScope, type PortalScope, type PortalScopeResult } from "@/modules/portal/scope";

/**
 * Boilerplate every portal page needs: resolve the scope, pick the child in
 * view, and fetch the switcher's labels. Centralised so no page can forget
 * the `studentInScope` check — the one call that stops a hand-edited `?child`
 * from reaching another family's records.
 */

export type PortalPageResult =
  | { ok: true; scope: PortalScope; studentId: string; children: { id: string; firstName: string; lastName: string }[] }
  | { ok: false; result: PortalScopeResult };

export async function loadPortalPage(requestedChildId: string | undefined): Promise<PortalPageResult> {
  const result = await getPortalScope();
  if (!result.ok) return { ok: false, result };

  const studentId = studentInScope(result.scope, requestedChildId);
  if (!studentId) {
    // Distinguish "your account has no children" from "that isn't one of
    // yours". Both are refused identically, but telling a parent with a
    // stale bookmark that their account is broken sends them to the school
    // office over nothing.
    const reason = result.scope.studentIds.length > 0 ? ("not_your_child" as const) : ("nothing_linked" as const);
    return { ok: false, result: { ok: false, reason, viewer: result.scope.viewer } };
  }

  const children = await db.student.findMany({
    where: { id: { in: result.scope.studentIds } },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { firstName: "asc" },
  });

  return { ok: true, scope: result.scope, studentId, children };
}

export function portalDenialMessage(result: PortalScopeResult): { title: string; body: string } {
  if (result.ok) return { title: "", body: "" };
  switch (result.reason) {
    case "not_a_portal_user":
      return {
        title: "This is the family portal",
        body: "Your account is a staff account. Sign in to the main application instead — the portal is for parents, students and drivers.",
      };
    case "feature_disabled":
      return { title: "The portal is switched off", body: "Your school has not enabled the family portal yet. Please contact the school office." };
    case "nothing_linked":
      return {
        title: "Nothing is linked to your account yet",
        body: "Your login exists but no student is linked to it. The school office can connect your account to your child's record.",
      };
    case "no_vehicle":
      return {
        title: "No vehicle is assigned to you",
        body: "Your driver account is not linked to a vehicle yet, so there is no route to show. The transport office can assign one.",
      };
    case "not_your_child":
      return {
        title: "That record isn't yours to see",
        body: "This portal only shows your own records. If you followed an old link, go back to the home tab and start again from there.",
      };
  }
}
