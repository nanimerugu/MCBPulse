import "server-only";
import { db } from "@/lib/db";
import type { ModuleAccess } from "@/modules/sis/access";

/**
 * The attribute-policy stage of authorize(), made concrete. `resolveAccess`
 * says whether a grant is section-scoped; this turns that into the list of
 * sections the viewer may actually see — the ones they hold a
 * SubjectAssignment in for the branch's current academic year.
 *
 * `sectionIds === null` means unrestricted. An empty array means "scoped,
 * but assigned to nothing" — which correctly shows an empty list rather
 * than everything.
 */
export interface SectionScope {
  staffId: string | null;
  sectionIds: string[] | null;
}

export async function getStaffForViewer(userId: string, organizationId: string) {
  return db.staff.findFirst({
    where: { userId, organizationId, deletedAt: null },
    select: { id: true, branchId: true, designation: true },
  });
}

export async function assignedSectionIds(staffId: string, branchId: string): Promise<string[]> {
  const rows = await db.subjectAssignment.findMany({
    where: {
      staffId,
      section: {
        deletedAt: null,
        grade: { branchId, deletedAt: null },
        academicYear: { isCurrent: true, deletedAt: null },
      },
    },
    select: { sectionId: true },
    distinct: ["sectionId"],
  });
  return rows.map((r) => r.sectionId);
}

export async function getSectionScope(access: ModuleAccess): Promise<SectionScope> {
  const staff = await getStaffForViewer(access.viewer.userId, access.ctx.organizationId);
  if (!access.decision.sectionScoped) return { staffId: staff?.id ?? null, sectionIds: null };
  if (!staff) return { staffId: null, sectionIds: [] };
  return { staffId: staff.id, sectionIds: await assignedSectionIds(staff.id, access.ctx.branch.id) };
}

export function sectionInScope(scope: SectionScope, sectionId: string | null | undefined): boolean {
  if (scope.sectionIds === null) return true;
  return Boolean(sectionId) && scope.sectionIds.includes(sectionId as string);
}
