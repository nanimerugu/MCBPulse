import "server-only";
import { redirect } from "next/navigation";
import { getViewerContext, type ViewerContext } from "@/lib/tenant";
import { resolveBranchContext, type BranchContext } from "@/lib/branch-context";
import { authorize, requirePermission, ForbiddenError } from "@/lib/rbac";
import type { Action } from "@/lib/permissions";
import { isFeatureEnabled } from "@/lib/feature-flags";
import type { Actor } from "@/modules/sis/students.service";

export const SIS_FLAG = "phase1.sis";

export interface SisAccess {
  viewer: ViewerContext;
  ctx: BranchContext;
}

export type SisAccessResult =
  | { ok: true; access: SisAccess }
  | { ok: false; reason: "no_branch" | "feature_disabled" | "forbidden"; viewer: ViewerContext; ctx: BranchContext | null };

/**
 * The one gate every SIS page passes through, in the blueprint's order:
 * tenant (which branch?) → feature flag → authorize(). Pages render an
 * explanation for each failure instead of a bare 403, because "you have no
 * branch yet" and "you lack sis.students:view" need different fixes.
 */
export async function loadSisAccess(
  requestedBranchId: string | undefined,
  module: string,
  action: Action,
): Promise<SisAccessResult> {
  const viewer = await getViewerContext();
  if (!viewer) redirect("/login");

  const ctx = await resolveBranchContext(viewer, requestedBranchId);
  if (!ctx) return { ok: false, reason: "no_branch", viewer, ctx: null };

  if (!(await isFeatureEnabled(SIS_FLAG, ctx.organizationId))) {
    return { ok: false, reason: "feature_disabled", viewer, ctx };
  }

  const allowed = await authorize(viewer.userId, module, action, {
    organizationId: ctx.organizationId,
    branchId: ctx.branch.id,
  });
  if (!allowed) return { ok: false, reason: "forbidden", viewer, ctx };

  return { ok: true, access: { viewer, ctx } };
}

/**
 * Server-action variant: the form names the branch it was rendered for, and
 * that exact branch must be one the viewer may act in. `resolveBranchContext`
 * falls back to a default branch for an unknown id — fine for navigation,
 * wrong for a write — so the equality check here is what stops a tampered
 * hidden field from writing into a branch the viewer can't see.
 */
export async function requireSisAccessForAction(
  branchId: string | undefined,
  module: string,
  action: Action,
): Promise<SisAccess> {
  const viewer = await getViewerContext();
  if (!viewer) throw new ForbiddenError("Not signed in");
  if (!branchId) throw new ForbiddenError("Missing branch");

  const ctx = await resolveBranchContext(viewer, branchId);
  if (!ctx || ctx.branch.id !== branchId) throw new ForbiddenError("Branch not permitted");

  if (!(await isFeatureEnabled(SIS_FLAG, ctx.organizationId))) throw new ForbiddenError("SIS is not enabled");

  await requirePermission(viewer.userId, module, action, { organizationId: ctx.organizationId, branchId });
  return { viewer, ctx };
}

export function actorOf(access: SisAccess): Actor {
  return { userId: access.viewer.userId, organizationId: access.ctx.organizationId };
}

/** Pull a single string out of Next's searchParams shape. */
export function param(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

export function str(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
}
