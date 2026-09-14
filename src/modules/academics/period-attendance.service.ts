import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { AttendanceStatus } from "@/generated/prisma/enums";
import { defaultStatus } from "@/modules/academics/attendance-summary";
import { approvedLeaveOn } from "@/modules/academics/leave.service";
import { dayOfWeekForISODate, isLessonTeacher, registerWindow } from "@/modules/academics/substitution";
import type { RegisterMark } from "@/modules/academics/attendance.service";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * Period-wise attendance: a register per LESSON.
 *
 * The daily register (attendance.service.ts) stays the official record —
 * absence notices, report cards and summaries read it, and nothing here
 * changes it. A period register records who was in one lesson. The point is
 * the gap between the two: present at 8am, missing from third-period
 * chemistry. So each row shows what the daily register says beside it.
 *
 * No guardian messages are sent from here, deliberately: the daily register
 * already tells families about a whole-day absence, and texting a parent six
 * times a day because a child was marked out of six lessons is how a school
 * teaches families to ignore its messages.
 */

export interface PeriodScope {
  organizationId: string;
  branchId: string;
}

const utcDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const slotInclude = {
  subject: true,
  section: { include: { grade: true } },
  staff: { include: { user: { select: { name: true } } } },
} as const;

async function registersFor(slotIds: string[], date: Date) {
  if (slotIds.length === 0) return new Map<string, { id: string; takenAt: Date }>();
  const rows = await db.periodRegister.findMany({ where: { slotId: { in: slotIds }, date }, select: { id: true, slotId: true, updatedAt: true } });
  return new Map(rows.map((r) => [r.slotId, { id: r.id, takenAt: r.updatedAt }]));
}

/**
 * A teacher's lessons that day: their own timetable, plus any lesson they are
 * covering. A lesson of theirs that someone ELSE is covering is listed too,
 * marked as such, so a teacher back from leave can see who took their class.
 */
export async function lessonsForTeacher(staffId: string, scope: PeriodScope, dateISO: string) {
  const date = utcDate(dateISO);
  const day = dayOfWeekForISODate(dateISO);
  const [own, covering] = await Promise.all([
    db.timetableSlot.findMany({
      where: { staffId, dayOfWeek: day, section: { deletedAt: null, grade: { branchId: scope.branchId }, academicYear: { isCurrent: true } } },
      include: { ...slotInclude, substitutions: { where: { date }, include: { substituteStaff: { include: { user: { select: { name: true } } } } } } },
    }),
    db.substitution.findMany({
      where: { substituteStaffId: staffId, date, slot: { section: { grade: { branchId: scope.branchId } } } },
      include: { slot: { include: slotInclude } },
    }),
  ]);
  const registers = await registersFor([...own.map((s) => s.id), ...covering.map((c) => c.slotId)], date);

  const lessons = [
    ...own.map((s) => ({
      slot: s,
      role: s.substitutions[0] ? ("covered_by_other" as const) : ("own" as const),
      coverName: s.substitutions[0]?.substituteStaff.user.name ?? null,
      register: registers.get(s.id) ?? null,
    })),
    ...covering.map((c) => ({ slot: c.slot, role: "covering" as const, coverName: null, register: registers.get(c.slotId) ?? null })),
  ];
  return lessons.sort((a, b) => a.slot.startTime.localeCompare(b.slot.startTime));
}

/** Every lesson a section has that day — the administrator's view. */
export async function lessonsForSection(sectionId: string, scope: PeriodScope, dateISO: string) {
  const date = utcDate(dateISO);
  const slots = await db.timetableSlot.findMany({
    where: { sectionId, dayOfWeek: dayOfWeekForISODate(dateISO), section: { deletedAt: null, grade: { branchId: scope.branchId, branch: { organizationId: scope.organizationId } } } },
    include: { ...slotInclude, substitutions: { where: { date }, include: { substituteStaff: { include: { user: { select: { name: true } } } } } } },
    orderBy: { startTime: "asc" },
  });
  const registers = await registersFor(slots.map((s) => s.id), date);
  return slots.map((s) => ({
    slot: s,
    role: s.substitutions[0] ? ("covered_by_other" as const) : ("own" as const),
    coverName: s.substitutions[0]?.substituteStaff.user.name ?? null,
    register: registers.get(s.id) ?? null,
  }));
}

export interface PeriodRow {
  studentId: string;
  admissionNumber: string;
  name: string;
  status: AttendanceStatus;
  remarks: string;
  version: number | null;
  onApprovedLeave: boolean;
  /** What the day's official register says, for contrast; null if not taken. */
  dailyStatus: AttendanceStatus | null;
}

export async function getPeriodRegister(slotId: string, dateISO: string, scope: PeriodScope) {
  const slot = await db.timetableSlot.findFirst({
    where: { id: slotId, section: { deletedAt: null, grade: { branchId: scope.branchId, branch: { organizationId: scope.organizationId } } } },
    include: slotInclude,
  });
  if (!slot || slot.dayOfWeek !== dayOfWeekForISODate(dateISO)) return null;

  const date = utcDate(dateISO);
  const [cover, register, students, daily, leave] = await Promise.all([
    db.substitution.findUnique({ where: { slotId_date: { slotId, date } }, include: { substituteStaff: { include: { user: { select: { name: true } } } } } }),
    db.periodRegister.findUnique({ where: { slotId_date: { slotId, date } }, include: { marks: true, takenByStaff: { include: { user: { select: { name: true } } } } } }),
    db.student.findMany({
      where: { currentSectionId: slot.sectionId, status: "ENROLLED", deletedAt: null },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, admissionNumber: true, firstName: true, lastName: true },
    }),
    db.attendanceSession.findUnique({ where: { sectionId_date: { sectionId: slot.sectionId, date } }, include: { records: { select: { studentId: true, status: true } } } }),
    approvedLeaveOn(slot.sectionId, date),
  ]);

  const rows: PeriodRow[] = students.map((s) => {
    const mark = register?.marks.find((m) => m.studentId === s.id);
    const dailyStatus = daily?.records.find((r) => r.studentId === s.id)?.status ?? null;
    return {
      studentId: s.id,
      admissionNumber: s.admissionNumber,
      name: `${s.firstName} ${s.lastName}`.trim(),
      // A child the daily register already has as absent defaults to absent
      // here too; the teacher only changes what differs.
      status: mark?.status ?? (dailyStatus === "ABSENT" ? "ABSENT" : defaultStatus(leave.has(s.id))),
      remarks: mark?.remarks ?? "",
      version: mark?.version ?? null,
      onApprovedLeave: leave.has(s.id),
      dailyStatus,
    };
  });

  return { slot, cover, register, rows };
}

export async function savePeriodRegister(
  slotId: string,
  dateISO: string,
  marks: RegisterMark[],
  opts: { viewerStaffId: string | null; unscopedTaker: boolean; canApprove: boolean; todayISO: string },
  scope: PeriodScope,
  actor: Actor,
) {
  const slot = await db.timetableSlot.findFirst({
    where: { id: slotId, section: { deletedAt: null, grade: { branchId: scope.branchId, branch: { organizationId: scope.organizationId } }, academicYear: { isCurrent: true } } },
    include: slotInclude,
  });
  if (!slot) throw new SisError("Lesson not found");
  if (slot.dayOfWeek !== dayOfWeekForISODate(dateISO)) throw new SisError("That lesson isn't on the timetable that day");

  const date = utcDate(dateISO);
  const cover = await db.substitution.findUnique({ where: { slotId_date: { slotId, date } }, select: { substituteStaffId: true } });

  // Who may take THIS lesson's register: its teacher for the day — the
  // substitute when cover is arranged — or a school-wide administrator. A
  // teacher who happens to teach the same section another period may not.
  if (!opts.unscopedTaker && !isLessonTeacher({ viewerStaffId: opts.viewerStaffId, slotStaffId: slot.staffId, coverStaffId: cover?.substituteStaffId ?? null })) {
    throw new SisError(cover ? "Cover has been arranged for this lesson — its register belongs to the substitute" : "Only this lesson's teacher can take its register");
  }
  const window = registerWindow({ lessonDateISO: dateISO, todayISO: opts.todayISO, canApprove: opts.canApprove });
  if (!window.ok) throw new SisError(window.message);
  if (marks.length === 0) throw new SisError("No students to mark");

  const enrolled = new Set(
    (await db.student.findMany({ where: { currentSectionId: slot.sectionId, status: "ENROLLED", deletedAt: null }, select: { id: true } })).map((s) => s.id),
  );
  for (const m of marks) if (!enrolled.has(m.studentId)) throw new SisError("A marked student isn't in this class — reload the register");

  let result: { registerId: string; created: boolean; changed: number };
  try {
    result = await db.$transaction(async (tx) => {
      const existing = await tx.periodRegister.findUnique({ where: { slotId_date: { slotId, date } }, include: { marks: true } });
      if (!existing) {
        const created = await tx.periodRegister.create({
          data: {
            slotId,
            date,
            takenByUserId: actor.userId,
            takenByStaffId: opts.viewerStaffId,
            marks: { create: marks.map((m) => ({ studentId: m.studentId, status: m.status, remarks: m.remarks?.trim() || null })) },
          },
        });
        return { registerId: created.id, created: true, changed: marks.length };
      }
      let changed = 0;
      for (const m of marks) {
        const current = existing.marks.find((x) => x.studentId === m.studentId);
        const remarks = m.remarks?.trim() || null;
        if (!current) {
          await tx.periodMark.create({ data: { registerId: existing.id, studentId: m.studentId, status: m.status, remarks } });
          changed++;
          continue;
        }
        if (current.status === m.status && (current.remarks ?? null) === remarks) continue;
        const { count } = await tx.periodMark.updateMany({
          where: { id: current.id, version: m.version ?? current.version },
          data: { status: m.status, remarks, version: { increment: 1 } },
        });
        if (count === 0) throw new SisError("Someone else changed this register while you were editing — reload and try again");
        changed++;
      }
      if (changed > 0) await tx.periodRegister.update({ where: { id: existing.id }, data: { takenByUserId: actor.userId } });
      return { registerId: existing.id, created: false, changed };
    });
  } catch (e) {
    // Two people saving a brand-new register at once: one wins the unique key.
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      throw new SisError("Someone else just saved this register — reload and check it");
    }
    throw e;
  }

  if (result.changed > 0) {
    const absent = marks.filter((m) => m.status === "ABSENT").length;
    await recordAuditEvent({
      organizationId: scope.organizationId,
      actorUserId: actor.userId,
      action: result.created ? "attendance.period_taken" : "attendance.period_corrected",
      resourceType: "timetable_slot",
      resourceId: slotId,
      after: {
        lesson: `${slot.section.grade.name} / ${slot.section.name} ${slot.subject.code} ${slot.startTime}–${slot.endTime}`,
        date: dateISO,
        absent,
        changed: result.changed,
        asCover: Boolean(cover && cover.substituteStaffId === opts.viewerStaffId),
      },
    });
  }
  return result;
}
