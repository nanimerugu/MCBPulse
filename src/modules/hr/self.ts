import "server-only";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getViewerContext, type ViewerContext } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { HR_FLAG } from "@/modules/sis/access";

/**
 * Staff self-service: your own leave, your own payslips, your own record.
 *
 * The README said three times that this needed "an attribute policy scoping
 * hr.leave to the requester's own staff record". That framing was the
 * problem. `hr.leave` is the permission to administer OTHER PEOPLE's leave,
 * and no amount of scoping makes granting it to every teacher safe — one
 * missed filter and a teacher reads the whole staff's leave history.
 *
 * So this surface takes no module permission at all. It resolves the
 * viewer's own Staff row and every query is built from that id, which is
 * never read from a form or a query string. There is nothing to scope
 * because there is nothing to widen: you can always see your own leave, and
 * you can never see anyone else's from here.
 *
 * Same inversion as the Phase 9 portal, for the same reason.
 */

export interface StaffSelf {
  viewer: ViewerContext;
  staffId: string;
  organizationId: string;
  branchId: string | null;
  name: string;
  employeeCode: string;
}

export type StaffSelfResult = { ok: true; self: StaffSelf } | { ok: false; reason: "not_staff" | "feature_disabled" | "exited"; viewer: ViewerContext };

export async function getStaffSelf(): Promise<StaffSelfResult> {
  const viewer = await getViewerContext();
  if (!viewer) redirect("/login");

  const staff = await db.staff.findFirst({
    where: { userId: viewer.userId, deletedAt: null },
    include: { user: true },
  });
  if (!staff) return { ok: false, reason: "not_staff", viewer };
  if (staff.exitDate) return { ok: false, reason: "exited", viewer };
  if (!(await isFeatureEnabled(HR_FLAG, staff.organizationId))) return { ok: false, reason: "feature_disabled", viewer };

  return {
    ok: true,
    self: {
      viewer,
      staffId: staff.id,
      organizationId: staff.organizationId,
      branchId: staff.branchId,
      name: staff.user.name,
      employeeCode: staff.employeeCode,
    },
  };
}

export async function listOwnLeave(self: StaffSelf) {
  return db.leaveRequest.findMany({
    where: { staffId: self.staffId },
    orderBy: [{ fromDate: "desc" }],
    take: 50,
  });
}

/**
 * Own payslips. Note this does NOT require `hr.compensation:view` — that
 * permission is about seeing OTHER people's pay. Your own payslip is yours.
 */
export async function listOwnPayslips(self: StaffSelf) {
  return db.payslip.findMany({
    where: { staffId: self.staffId, payrollRun: { status: { in: ["PROCESSED", "PAID"] } } },
    include: { payrollRun: true, lines: { orderBy: { sequence: "asc" } } },
    orderBy: [{ payrollRun: { periodYear: "desc" } }, { payrollRun: { periodMonth: "desc" } }],
    take: 24,
  });
}

export async function getOwnProfile(self: StaffSelf) {
  return db.staff.findUnique({
    where: { id: self.staffId },
    include: {
      user: true,
      branch: true,
      department: true,
      position: true,
      appraisals: { include: { academicYear: true }, orderBy: { submittedAt: "desc" } },
    },
  });
}

export function selfDenialMessage(result: StaffSelfResult): { title: string; body: string } {
  if (result.ok) return { title: "", body: "" };
  switch (result.reason) {
    case "not_staff":
      return {
        title: "You don't have a staff record",
        body: "This page shows your own leave and payslips, and your login isn't linked to a staff record. The HR office can link it.",
      };
    case "exited":
      return { title: "Your staff record is marked as exited", body: "Please contact the HR office." };
    case "feature_disabled":
      return { title: "HR is switched off", body: "Your school has not enabled the HR module." };
  }
}
