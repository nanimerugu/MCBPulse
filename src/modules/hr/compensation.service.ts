import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { fromMinor, toMinor } from "@/modules/finance/money";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * Salary and exit, the two staff fields that are nobody's business by
 * default. `hr.compensation:view` is a separate permission from
 * `sis.staff:view` precisely so a head of school can browse the staff
 * directory without seeing what anyone earns.
 *
 * Every change is audited with both the old and the new figure — a salary
 * that moved without a trace is exactly the kind of thing an audit log
 * exists for.
 */

export async function listStaffForHr(organizationId: string, branchId: string) {
  return db.staff.findMany({
    where: { organizationId, branchId, deletedAt: null },
    include: { user: true, department: true, position: true },
    orderBy: [{ exitDate: "asc" }, { employeeCode: "asc" }],
  });
}

export async function getStaffForHr(staffId: string, organizationId: string) {
  return db.staff.findFirst({
    where: { id: staffId, organizationId, deletedAt: null },
    include: {
      user: true,
      department: true,
      position: true,
      branch: true,
      appraisals: { include: { academicYear: true }, orderBy: { submittedAt: "desc" } },
      payslips: { include: { payrollRun: true }, orderBy: { generatedAt: "desc" }, take: 12 },
    },
  });
}

export async function setMonthlyGrossPay(staffId: string, grossMinor: number | null, actor: Actor) {
  const staff = await db.staff.findFirst({ where: { id: staffId, organizationId: actor.organizationId, deletedAt: null } });
  if (!staff) throw new SisError("Staff member not found");
  if (grossMinor !== null && grossMinor < 0) throw new SisError("Pay can't be negative");

  const before = staff.monthlyGrossPay === null ? null : toMinor(staff.monthlyGrossPay);
  await db.staff.update({ where: { id: staffId }, data: { monthlyGrossPay: grossMinor === null ? null : fromMinor(grossMinor) } });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "staff.pay_changed",
    resourceType: "staff",
    resourceId: staffId,
    before: { monthlyGrossPayMinor: before },
    after: { monthlyGrossPayMinor: grossMinor },
  });
}

/**
 * Recording an exit leaves the row intact. A departed employee still has
 * payslips, an appraisal history and an audit trail that must remain
 * readable; `exitDate` is what takes them off future payroll runs (see
 * isOnPayroll in payroll.ts) and out of the active directory.
 */
export async function recordStaffExit(staffId: string, input: { exitDate: Date; reason: string }, actor: Actor) {
  const staff = await db.staff.findFirst({
    where: { id: staffId, organizationId: actor.organizationId, deletedAt: null },
    include: { user: true },
  });
  if (!staff) throw new SisError("Staff member not found");
  if (staff.exitDate) throw new SisError("This staff member has already been marked as exited");
  if (input.exitDate.getTime() < staff.joinDate.getTime()) throw new SisError("The exit date is before the join date");

  await db.$transaction(async (tx) => {
    await tx.staff.update({ where: { id: staffId }, data: { exitDate: input.exitDate, exitReason: input.reason } });
    // The login goes too: an ex-employee keeping a working password is the
    // most common real-world offboarding failure.
    await tx.user.update({ where: { id: staff.userId }, data: { status: "DISABLED" } });
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "staff.exited",
    resourceType: "staff",
    resourceId: staffId,
    after: { exitDate: input.exitDate.toISOString().slice(0, 10), reason: input.reason, userDeactivated: staff.userId },
  });
}

export async function recordAppraisal(
  staffId: string,
  input: { academicYearId: string; score: number | null; comments: string },
  actor: Actor,
) {
  const staff = await db.staff.findFirst({ where: { id: staffId, organizationId: actor.organizationId, deletedAt: null } });
  if (!staff) throw new SisError("Staff member not found");

  const year = await db.academicYear.findFirst({
    where: { id: input.academicYearId, branch: { organizationId: actor.organizationId } },
  });
  if (!year) throw new SisError("Academic year not found");
  if (input.score !== null && (input.score < 1 || input.score > 5)) throw new SisError("Score must be between 1 and 5");

  // One appraisal per staff member per year; re-recording replaces it.
  const appraisal = await db.appraisal.upsert({
    where: { staffId_academicYearId: { staffId, academicYearId: input.academicYearId } },
    create: { staffId, academicYearId: input.academicYearId, score: input.score, comments: input.comments, submittedByUserId: actor.userId },
    update: { score: input.score, comments: input.comments, submittedByUserId: actor.userId, submittedAt: new Date() },
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "appraisal.recorded",
    resourceType: "staff",
    resourceId: staffId,
    after: { appraisalId: appraisal.id, academicYear: year.name, score: input.score },
  });
  return appraisal;
}
