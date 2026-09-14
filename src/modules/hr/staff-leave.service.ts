import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { findClash, toUtcDate, validateLeaveRange } from "@/modules/hr/leave";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * Staff leave. Rows live in the same LeaveRequest table as student leave
 * (Phase 2) but are always filtered by `staffId: { not: null }` plus the
 * staff member's organization — the table is shared, the tenancy is not.
 */

export async function listStaffLeave(organizationId: string, branchId: string, opts: { staffId?: string; pendingOnly?: boolean } = {}) {
  return db.leaveRequest.findMany({
    where: {
      staffId: opts.staffId ?? { not: null },
      ...(opts.pendingOnly ? { status: "PENDING" as const } : {}),
      staff: { organizationId, branchId, deletedAt: null },
    },
    include: { staff: { include: { user: true } } },
    orderBy: [{ status: "asc" }, { fromDate: "desc" }],
    take: 100,
  });
}

export async function requestStaffLeave(
  staffId: string,
  input: { fromDate: string; toDate: string; reason: string; unpaid?: boolean },
  actor: Actor,
) {
  const staff = await db.staff.findFirst({
    where: { id: staffId, organizationId: actor.organizationId, deletedAt: null },
    include: { user: true },
  });
  if (!staff) throw new SisError("Staff member not found");
  if (staff.exitDate) throw new SisError("This staff member has left; leave can't be recorded for them");

  const range = { fromDate: toUtcDate(input.fromDate), toDate: toUtcDate(input.toDate) };
  const valid = validateLeaveRange(range);
  if (!valid.ok) throw new SisError(valid.message);

  // Double-booked leave is how someone ends up "on leave" twice for the same
  // week and paid oddly for it, so the clash check happens before the write.
  const existing = await db.leaveRequest.findMany({
    where: { staffId, status: { in: ["PENDING", "APPROVED"] } },
    select: { id: true, fromDate: true, toDate: true, status: true },
  });
  const clash = findClash(range, existing);
  if (clash) {
    const from = clash.fromDate.toISOString().slice(0, 10);
    const to = clash.toDate.toISOString().slice(0, 10);
    throw new SisError(`This overlaps an existing ${clash.status.toLowerCase()} request (${from} to ${to})`);
  }

  // Loss of pay is a decision someone makes, so it is only ever set from the
  // HR form; staff filing their own leave can't mark it unpaid (or paid).
  const leave = await db.leaveRequest.create({ data: { staffId, ...range, reason: input.reason, unpaid: input.unpaid === true } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "staff_leave.requested",
    resourceType: "staff",
    resourceId: staffId,
    after: { leaveId: leave.id, from: input.fromDate, to: input.toDate, reason: input.reason, unpaid: input.unpaid === true },
  });
  return leave;
}

export async function decideStaffLeave(leaveId: string, decision: "APPROVED" | "REJECTED", actor: Actor) {
  const leave = await db.leaveRequest.findFirst({
    where: { id: leaveId, staffId: { not: null }, staff: { organizationId: actor.organizationId } },
  });
  if (!leave || !leave.staffId) throw new SisError("Leave request not found");
  if (leave.status !== "PENDING") throw new SisError(`This request was already ${leave.status.toLowerCase()}`);

  const updated = await db.leaveRequest.update({
    where: { id: leaveId },
    data: { status: decision, approvedByUserId: actor.userId },
  });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: decision === "APPROVED" ? "staff_leave.approved" : "staff_leave.rejected",
    resourceType: "staff",
    resourceId: leave.staffId,
    after: { leaveId, from: leave.fromDate.toISOString().slice(0, 10), to: leave.toDate.toISOString().slice(0, 10) },
  });
  return updated;
}

/** Approved staff leave overlapping a payroll month, for the run's context panel. */
export async function approvedLeaveInPeriod(organizationId: string, branchId: string, month: number, year: number) {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 0));
  return db.leaveRequest.findMany({
    where: {
      staffId: { not: null },
      status: "APPROVED",
      fromDate: { lte: periodEnd },
      toDate: { gte: periodStart },
      staff: { organizationId, branchId, deletedAt: null },
    },
    select: { staffId: true, fromDate: true, toDate: true },
  });
}
