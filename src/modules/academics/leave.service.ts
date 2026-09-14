import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { LeaveInput } from "@/modules/academics/schemas";
import { SisError, type Actor } from "@/modules/sis/students.service";
import { emit } from "@/modules/automation/emit";

function toUtcDate(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`);
}

export async function listStudentLeave(studentId: string, organizationId: string) {
  return db.leaveRequest.findMany({
    where: { studentId, student: { organizationId } },
    orderBy: { fromDate: "desc" },
    take: 20,
  });
}

export async function createStudentLeave(studentId: string, input: LeaveInput, actor: Actor) {
  const student = await db.student.findFirst({ where: { id: studentId, organizationId: actor.organizationId, deletedAt: null } });
  if (!student) throw new SisError("Student not found");

  const leave = await db.leaveRequest.create({
    data: { studentId, fromDate: toUtcDate(input.fromDate), toDate: toUtcDate(input.toDate), reason: input.reason },
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "leave.requested",
    resourceType: "student",
    resourceId: studentId,
    after: { leaveId: leave.id, from: input.fromDate, to: input.toDate, reason: input.reason },
  });

  return leave;
}

export async function decideStudentLeave(leaveId: string, decision: "APPROVED" | "REJECTED", actor: Actor) {
  const leave = await db.leaveRequest.findFirst({
    where: { id: leaveId, student: { organizationId: actor.organizationId } },
  });
  if (!leave || !leave.studentId) throw new SisError("Leave request not found");
  if (leave.status !== "PENDING") throw new SisError(`This request was already ${leave.status.toLowerCase()}`);

  const updated = await db.leaveRequest.update({
    where: { id: leaveId },
    data: { status: decision, approvedByUserId: actor.userId },
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: decision === "APPROVED" ? "leave.approved" : "leave.rejected",
    resourceType: "student",
    resourceId: leave.studentId,
    after: { leaveId, from: leave.fromDate.toISOString().slice(0, 10), to: leave.toDate.toISOString().slice(0, 10) },
  });

  if (decision === "APPROVED") {
    const student = await db.student.findUnique({ where: { id: leave.studentId }, select: { firstName: true, lastName: true } });
    await emit(
      "leave.approved",
      {
        "student.name": student ? `${student.firstName} ${student.lastName}` : null,
        // Inclusive: leave from Monday to Monday is one day, not zero.
        "leave.days": Math.round((leave.toDate.getTime() - leave.fromDate.getTime()) / 86_400_000) + 1,
        "leave.reason": leave.reason,
      },
      { organizationId: actor.organizationId, studentId: leave.studentId },
    );
  }

  return updated;
}

/** Students in a section with approved leave covering `date` — the register pre-fills them as Excused. */
export async function approvedLeaveOn(sectionId: string, date: Date): Promise<Set<string>> {
  const rows = await db.leaveRequest.findMany({
    where: { status: "APPROVED", fromDate: { lte: date }, toDate: { gte: date }, student: { currentSectionId: sectionId } },
    select: { studentId: true },
  });
  return new Set(rows.map((r) => r.studentId).filter((id): id is string => id !== null));
}
