import "server-only";
import { redirect } from "next/navigation";
import { getViewerContext, type ViewerContext } from "@/lib/tenant";
import { resolveBranchContext, type BranchContext } from "@/lib/branch-context";
import { resolveAccess, requirePermission, ForbiddenError, type AccessDecision } from "@/lib/rbac";
import type { Action } from "@/lib/permissions";
import { isFeatureEnabled } from "@/lib/feature-flags";
import type { Actor } from "@/modules/sis/students.service";

export const SIS_FLAG = "phase1.sis";
export const ACADEMICS_FLAG = "phase2.academics";
export const ADMISSIONS_FLAG = "phase3.admissions";
export const FINANCE_FLAG = "phase4.finance";
export const LMS_FLAG = "phase5.lms";
export const CONNECT_FLAG = "phase6.connect";
export const HR_FLAG = "phase7.hr";
export const OPERATIONS_FLAG = "phase8.operations";

export interface ModuleAccess {
  viewer: ViewerContext;
  ctx: BranchContext;
  /** The RBAC decision for the permission the page/action asked about. */
  decision: AccessDecision;
}
/** @deprecated name kept for the Phase 1 code; identical to ModuleAccess. */
export type SisAccess = ModuleAccess;

export type ModuleAccessResult =
  | { ok: true; access: ModuleAccess }
  | {
      ok: false;
      reason: "no_branch" | "feature_disabled" | "forbidden";
      viewer: ViewerContext;
      ctx: BranchContext | null;
      flag: string;
    };
export type SisAccessResult = ModuleAccessResult;

/**
 * The one gate every module page passes through, in the blueprint's order:
 * tenant (which branch?) → feature flag → authorize(). Pages render an
 * explanation for each failure instead of a bare 403, because "you have no
 * branch yet" and "you lack sis.students:view" need different fixes.
 */
export async function loadModuleAccess(
  requestedBranchId: string | undefined,
  flag: string,
  module: string,
  action: Action,
): Promise<ModuleAccessResult> {
  const viewer = await getViewerContext();
  if (!viewer) redirect("/login");

  const ctx = await resolveBranchContext(viewer, requestedBranchId);
  if (!ctx) return { ok: false, reason: "no_branch", viewer, ctx: null, flag };

  if (!(await isFeatureEnabled(flag, ctx.organizationId))) {
    return { ok: false, reason: "feature_disabled", viewer, ctx, flag };
  }

  const decision = await resolveAccess(viewer.userId, module, action, {
    organizationId: ctx.organizationId,
    branchId: ctx.branch.id,
  });
  if (!decision.allowed) return { ok: false, reason: "forbidden", viewer, ctx, flag };

  return { ok: true, access: { viewer, ctx, decision } };
}

/**
 * Server-action variant: the form names the branch it was rendered for, and
 * that exact branch must be one the viewer may act in. `resolveBranchContext`
 * falls back to a default branch for an unknown id — fine for navigation,
 * wrong for a write — so the equality check here is what stops a tampered
 * hidden field from writing into a branch the viewer can't see.
 */
export async function requireModuleAccessForAction(
  branchId: string | undefined,
  flag: string,
  module: string,
  action: Action,
): Promise<ModuleAccess> {
  const viewer = await getViewerContext();
  if (!viewer) throw new ForbiddenError("Not signed in");
  if (!branchId) throw new ForbiddenError("Missing branch");

  const ctx = await resolveBranchContext(viewer, branchId);
  if (!ctx || ctx.branch.id !== branchId) throw new ForbiddenError("Branch not permitted");

  if (!(await isFeatureEnabled(flag, ctx.organizationId))) throw new ForbiddenError("This module is not enabled");

  const decision = await requirePermission(viewer.userId, module, action, { organizationId: ctx.organizationId, branchId });
  return { viewer, ctx, decision };
}

export const loadSisAccess = (requestedBranchId: string | undefined, module: string, action: Action) =>
  loadModuleAccess(requestedBranchId, SIS_FLAG, module, action);
export const requireSisAccessForAction = (branchId: string | undefined, module: string, action: Action) =>
  requireModuleAccessForAction(branchId, SIS_FLAG, module, action);

export const loadAcademicsAccess = (requestedBranchId: string | undefined, module: string, action: Action) =>
  loadModuleAccess(requestedBranchId, ACADEMICS_FLAG, module, action);
export const requireAcademicsAccessForAction = (branchId: string | undefined, module: string, action: Action) =>
  requireModuleAccessForAction(branchId, ACADEMICS_FLAG, module, action);

export const loadAdmissionsAccess = (requestedBranchId: string | undefined, module: string, action: Action) =>
  loadModuleAccess(requestedBranchId, ADMISSIONS_FLAG, module, action);
export const requireAdmissionsAccessForAction = (branchId: string | undefined, module: string, action: Action) =>
  requireModuleAccessForAction(branchId, ADMISSIONS_FLAG, module, action);

export const loadFinanceAccess = (requestedBranchId: string | undefined, module: string, action: Action) =>
  loadModuleAccess(requestedBranchId, FINANCE_FLAG, module, action);
export const requireFinanceAccessForAction = (branchId: string | undefined, module: string, action: Action) =>
  requireModuleAccessForAction(branchId, FINANCE_FLAG, module, action);

export const loadLmsAccess = (requestedBranchId: string | undefined, module: string, action: Action) =>
  loadModuleAccess(requestedBranchId, LMS_FLAG, module, action);
export const requireLmsAccessForAction = (branchId: string | undefined, module: string, action: Action) =>
  requireModuleAccessForAction(branchId, LMS_FLAG, module, action);

export const loadConnectAccess = (requestedBranchId: string | undefined, module: string, action: Action) =>
  loadModuleAccess(requestedBranchId, CONNECT_FLAG, module, action);
export const requireConnectAccessForAction = (branchId: string | undefined, module: string, action: Action) =>
  requireModuleAccessForAction(branchId, CONNECT_FLAG, module, action);

export const loadHrAccess = (requestedBranchId: string | undefined, module: string, action: Action) =>
  loadModuleAccess(requestedBranchId, HR_FLAG, module, action);
export const requireHrAccessForAction = (branchId: string | undefined, module: string, action: Action) =>
  requireModuleAccessForAction(branchId, HR_FLAG, module, action);

/**
 * Branch → flag → "holds at least one of these permissions".
 *
 * Operations is six sub-modules behind six permissions, and its landing page
 * belongs to anyone who works in any of them: a hostel warden holding only
 * `ops.hostel` must reach it. Gating that page on a single permission would
 * shut out exactly the people the module is for. The page then shows only
 * the cards each viewer actually holds.
 */
export async function loadModuleAccessAny(
  requestedBranchId: string | undefined,
  flag: string,
  permissions: readonly { module: string; action: Action }[],
): Promise<ModuleAccessResult> {
  const viewer = await getViewerContext();
  if (!viewer) redirect("/login");

  const ctx = await resolveBranchContext(viewer, requestedBranchId);
  if (!ctx) return { ok: false, reason: "no_branch", viewer, ctx: null, flag };

  if (!(await isFeatureEnabled(flag, ctx.organizationId))) {
    return { ok: false, reason: "feature_disabled", viewer, ctx, flag };
  }

  const scope = { organizationId: ctx.organizationId, branchId: ctx.branch.id };
  for (const p of permissions) {
    const decision = await resolveAccess(viewer.userId, p.module, p.action, scope);
    if (decision.allowed) return { ok: true, access: { viewer, ctx, decision } };
  }
  return { ok: false, reason: "forbidden", viewer, ctx, flag };
}

export const loadOpsAccess = (requestedBranchId: string | undefined, module: string, action: Action) =>
  loadModuleAccess(requestedBranchId, OPERATIONS_FLAG, module, action);
export const loadOpsAccessAny = (requestedBranchId: string | undefined, permissions: readonly { module: string; action: Action }[]) =>
  loadModuleAccessAny(requestedBranchId, OPERATIONS_FLAG, permissions);
export const requireOpsAccessForAction = (branchId: string | undefined, module: string, action: Action) =>
  requireModuleAccessForAction(branchId, OPERATIONS_FLAG, module, action);

export function actorOf(access: ModuleAccess): Actor {
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
