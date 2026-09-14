import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { AttendanceStatus } from "@/generated/prisma/enums";
import { defaultStatus, summarize, summarizeByStudent, type AttendanceCounts } from "@/modules/academics/attendance-summary";
import { approvedLeaveOn } from "@/modules/academics/leave.service";
import { todaysSlotsForStaff } from "@/modules/academics/timetable.service";
import { SisError, type Actor } from "@/modules/sis/students.service";

function toUtcDate(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`);
}

export interface RegisterRow {
  studentId: string;
  admissionNumber: string;
  name: string;
  status: AttendanceStatus;
  remarks: string;
  /** null until a record exists; the form echoes it back for optimistic locking. */
  version: number | null;
  onApprovedLeave: boolean;
}

/**
 * The register for one section on one day: the enrolled students, each with
 * either their saved record or a default (Present, or Excused if on approved
 * leave). Returns null when the section isn't in this organization.
 */
export async function getRegister(sectionId: string, dateISO: string, organizationId: string) {
  const section = await db.section.findFirst({
    where: { id: sectionId, deletedAt: null, grade: { branch: { organizationId } } },
    include: { grade: true, academicYear: true },
  });
  if (!section) return null;

  const date = toUtcDate(dateISO);
  const [session, students, leave] = await Promise.all([
    db.attendanceSession.findUnique({
      where: { sectionId_date: { sectionId, date } },
      include: { records: true, takenByStaff: { include: { user: { select: { name: true } } } } },
    }),
    db.student.findMany({
      where: { currentSectionId: sectionId, status: "ENROLLED", deletedAt: null },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, admissionNumber: true, firstName: true, lastName: true },
    }),
    approvedLeaveOn(sectionId, date),
  ]);

  const rows: RegisterRow[] = students.map((s) => {
    const record = session?.records.find((r) => r.studentId === s.id);
    return {
      studentId: s.id,
      admissionNumber: s.admissionNumber,
      name: `${s.firstName} ${s.lastName}`.trim(),
      status: record?.status ?? defaultStatus(leave.has(s.id)),
      remarks: record?.remarks ?? "",
      version: record?.version ?? null,
      onApprovedLeave: leave.has(s.id),
    };
  });

  return { section, session, rows, dateISO };
}

export interface RegisterMark {
  studentId: string;
  status: AttendanceStatus;
  remarks?: string;
  /** Echoed from the form; a mismatch means someone saved in between. */
  version?: number;
}

/**
 * Create or correct a register. First save creates the session and every
 * record; later saves update records with an optimistic-lock check on
 * `version` (blueprint section 9 names attendance as a high-conflict record)
 * and refuse when the session is locked unless the caller may approve.
 */
export async function saveRegister(
  sectionId: string,
  dateISO: string,
  marks: RegisterMark[],
  opts: { staffId: string | null; canApprove: boolean; branchId: string },
  actor: Actor,
) {
  const section = await db.section.findFirst({
    where: { id: sectionId, deletedAt: null, grade: { branchId: opts.branchId, deletedAt: null }, academicYear: { isCurrent: true, deletedAt: null } },
    include: { grade: true },
  });
  if (!section) throw new SisError("That section isn't in this branch's current academic year");
  if (marks.length === 0) throw new SisError("No students to mark");

  const date = toUtcDate(dateISO);
  const enrolled = new Set(
    (await db.student.findMany({ where: { currentSectionId: sectionId, status: "ENROLLED", deletedAt: null }, select: { id: true } })).map((s) => s.id),
  );
  for (const m of marks) {
    if (!enrolled.has(m.studentId)) throw new SisError("A marked student isn't enrolled in this section — reload the register");
  }

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.attendanceSession.findUnique({ where: { sectionId_date: { sectionId, date } }, include: { records: true } });

    if (!existing) {
      const session = await tx.attendanceSession.create({
        data: {
          sectionId,
          date,
          takenByUserId: actor.userId,
          takenByStaffId: opts.staffId,
          records: { create: marks.map((m) => ({ studentId: m.studentId, status: m.status, remarks: m.remarks?.trim() || null })) },
        },
      });
      return { session, created: true, changed: marks.length };
    }

    if (existing.lockedAt && !opts.canApprove) {
      throw new SisError("This register is locked. Someone with approval rights must unlock it or make the correction.");
    }

    let changed = 0;
    for (const m of marks) {
      const record = existing.records.find((r) => r.studentId === m.studentId);
      if (!record) {
        await tx.attendanceRecord.create({ data: { sessionId: existing.id, studentId: m.studentId, status: m.status, remarks: m.remarks?.trim() || null } });
        changed++;
        continue;
      }
      const remarks = m.remarks?.trim() || null;
      if (record.status === m.status && (record.remarks ?? null) === remarks) continue;
      const { count } = await tx.attendanceRecord.updateMany({
        where: { id: record.id, version: m.version ?? record.version },
        data: { status: m.status, remarks, version: { increment: 1 } },
      });
      if (count === 0) {
        throw new SisError("Someone else changed this register while you were editing — reload and try again");
      }
      changed++;
    }
    return { session: existing, created: false, changed };
  });

  const counts = summarize(marks.map((m) => m.status));
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: result.created ? "attendance.taken" : "attendance.corrected",
    resourceType: "attendance_session",
    resourceId: result.session.id,
    after: {
      section: `${section.grade.name} / ${section.name}`,
      date: dateISO,
      present: counts.present,
      late: counts.late,
      absent: counts.absent,
      excused: counts.excused,
      ...(result.created ? {} : { changed: result.changed, wasLocked: Boolean(result.session.lockedAt) }),
    },
  });

  return result;
}

export async function setSessionLock(sessionId: string, locked: boolean, actor: Actor) {
  const session = await db.attendanceSession.findFirst({
    where: { id: sessionId, section: { grade: { branch: { organizationId: actor.organizationId } } } },
    include: { section: { include: { grade: true } } },
  });
  if (!session) throw new SisError("Register not found");

  await db.attendanceSession.update({
    where: { id: sessionId },
    data: locked ? { lockedAt: new Date(), lockedByUserId: actor.userId } : { lockedAt: null, lockedByUserId: null },
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: locked ? "attendance.locked" : "attendance.unlocked",
    resourceType: "attendance_session",
    resourceId: sessionId,
    after: { section: `${session.section.grade.name} / ${session.section.name}`, date: session.date.toISOString().slice(0, 10) },
  });
}

export interface StudentSummaryRow {
  studentId: string;
  admissionNumber: string;
  name: string;
  counts: AttendanceCounts;
}

/** Per-student attendance for a section over an inclusive date range. */
export async function sectionSummary(sectionId: string, fromISO: string, toISO: string): Promise<{ rows: StudentSummaryRow[]; sessions: number }> {
  const records = await db.attendanceRecord.findMany({
    where: { session: { sectionId, date: { gte: toUtcDate(fromISO), lte: toUtcDate(toISO) } } },
    select: { studentId: true, status: true, student: { select: { admissionNumber: true, firstName: true, lastName: true } } },
  });
  const sessions = await db.attendanceSession.count({ where: { sectionId, date: { gte: toUtcDate(fromISO), lte: toUtcDate(toISO) } } });
  const byStudent = summarizeByStudent(records);
  const names = new Map(records.map((r) => [r.studentId, r.student]));
  const rows: StudentSummaryRow[] = [...byStudent.entries()]
    .map(([studentId, counts]) => {
      const s = names.get(studentId)!;
      return { studentId, admissionNumber: s.admissionNumber, name: `${s.firstName} ${s.lastName}`.trim(), counts };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { rows, sessions };
}

/** A student's attendance since a date (the current academic year's start, typically). */
export async function studentAttendanceCounts(studentId: string, sinceISO: string | null): Promise<AttendanceCounts> {
  const records = await db.attendanceRecord.findMany({
    where: { studentId, ...(sinceISO ? { session: { date: { gte: toUtcDate(sinceISO) } } } : {}) },
    select: { status: true },
  });
  return summarize(records.map((r) => r.status));
}

/** Sections on a teacher's timetable today that have no register yet. */
export async function pendingSectionsForStaff(staffId: string, date = new Date()) {
  const slots = await todaysSlotsForStaff(staffId, date);
  const sectionIds = [...new Set(slots.map((s) => s.sectionId))];
  if (sectionIds.length === 0) return [];
  const dayStart = toUtcDate(date.toISOString().slice(0, 10));
  const taken = await db.attendanceSession.findMany({ where: { sectionId: { in: sectionIds }, date: dayStart }, select: { sectionId: true } });
  const takenIds = new Set(taken.map((t) => t.sectionId));
  const seen = new Set<string>();
  return slots
    .filter((s) => !takenIds.has(s.sectionId) && !seen.has(s.sectionId) && seen.add(s.sectionId))
    .map((s) => ({ sectionId: s.sectionId, label: `${s.section.grade.name} / ${s.section.name}` }));
}
