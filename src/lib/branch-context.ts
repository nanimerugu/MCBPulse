import "server-only";
import { db } from "@/lib/db";
import type { ViewerContext } from "@/lib/tenant";

export interface BranchContext {
  organizationId: string;
  /** Branches this viewer may act in. Org-wide assignment → every branch. */
  branches: { id: string; name: string; code: string }[];
  branch: { id: string; name: string; code: string };
  /** The branch's current academic year, or null if none is flagged current. */
  academicYear: { id: string; name: string } | null;
}

/**
 * Which branch is the viewer working in right now?
 *
 * Branch-scoped role assignments pin the answer; an org-wide assignment
 * (branchId = null) may pick any branch, defaulting to the first. The chosen
 * branch travels as a `?branch=` query param so it survives navigation —
 * that's the "tenant switcher" for now, deliberately minimal. Returns null
 * when the viewer has no organization or the org has no branches yet.
 */
export async function resolveBranchContext(
  viewer: ViewerContext,
  requestedBranchId: string | undefined,
): Promise<BranchContext | null> {
  if (!viewer.organizationId) return null;

  const allBranches = await db.branch.findMany({
    where: { organizationId: viewer.organizationId, deletedAt: null },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });
  if (allBranches.length === 0) return null;

  const orgWide = viewer.assignments.some(
    (a) => a.organizationId === viewer.organizationId && a.branchId === null,
  );
  const pinned = new Set(
    viewer.assignments
      .filter((a) => a.organizationId === viewer.organizationId && a.branchId)
      .map((a) => a.branchId as string),
  );
  const branches = orgWide ? allBranches : allBranches.filter((b) => pinned.has(b.id));
  if (branches.length === 0) return null;

  const branch = branches.find((b) => b.id === requestedBranchId) ?? branches[0];

  const academicYear = await db.academicYear.findFirst({
    where: { branchId: branch.id, isCurrent: true, deletedAt: null },
    select: { id: true, name: true },
  });

  return { organizationId: viewer.organizationId, branches, branch, academicYear };
}

/** Preserve the active branch across links: `href={withBranch("/students", ctx)}`. */
export function withBranch(path: string, ctx: Pick<BranchContext, "branch" | "branches">): string {
  if (ctx.branches.length <= 1) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}branch=${ctx.branch.id}`;
}
