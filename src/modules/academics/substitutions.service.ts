import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { notifyUser } from "@/modules/connect/notify";
import {
  assessCandidate,
  BLOCKER_LABELS,
  coverState,
  dayOfWeekForISODate,
  rankSubstitutes,
  type CandidateFacts,
  type LessonToCover,
} from "@/modules/academics/substitution";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * Cover for absent teachers (blueprint 11.4 "substitutions").
 *
 * The day's lessons are read from the weekly timetable; who is away comes
 * from approved staff leave; cover is a Substitution row per lesson per date.
 * Cover can be arranged without any leave recorded — a teacher phoning in
 * sick at 7am hasn't filed a form, and the lesson still needs a teacher.
 */

export interface CoverScope {
  organizationId: string;
  branchId: string;
}

const utcDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const slotInclude = {
  subject: true,
  section: { include: { grade: true } },
  staff: { include: { user: { select: { id: true, name: true } } } },
} as const;

async function staffOnLeave(scope: CoverScope, date: Date): Promise<Set<string>> {
  const rows = await db.leaveRequest.findMany({
    where: { staffId: { not: null }, status: "APPROVED", fromDate: { lte: date }, toDate: { gte: date }, staff: { organizationId: scope.organizationId, deletedAt: null } },
    select: { staffId: true },
  });
  return new Set(rows.map((r) => r.staffId).filter((id): id is string => id !== null));
}

/** Every lesson on the branch timetable that day, with who is away and who is covering. */
export async function lessonsOn(scope: CoverScope, dateISO: string) {
  const date = utcDate(dateISO);
  const [slots, onLeave, covers] = await Promise.all([
    db.timetableSlot.findMany({
      where: {
        dayOfWeek: dayOfWeekForISODate(dateISO),
        section: { deletedAt: null, grade: { branchId: scope.branchId, deletedAt: null, branch: { organizationId: scope.organizationId } }, academicYear: { isCurrent: true, deletedAt: null } },
      },
      include: slotInclude,
      orderBy: [{ startTime: "asc" }],
    }),
    staffOnLeave(scope, date),
    db.substitution.findMany({
      where: { date, slot: { section: { grade: { branchId: scope.branchId } } } },
      include: { substituteStaff: { include: { user: { select: { name: true } } } } },
    }),
  ]);
  const coverBySlot = new Map(covers.map((c) => [c.slotId, c]));
  return slots.map((slot) => {
    const cover = coverBySlot.get(slot.id) ?? null;
    return { slot, cover, state: coverState(slot, onLeave, cover !== null), teacherOnLeave: onLeave.has(slot.staffId) };
  });
}

async function loadSlot(slotId: string, dateISO: string, scope: CoverScope) {
  const slot = await db.timetableSlot.findFirst({
    where: { id: slotId, section: { deletedAt: null, grade: { branchId: scope.branchId, branch: { organizationId: scope.organizationId } }, academicYear: { isCurrent: true } } },
    include: slotInclude,
  });
  if (!slot) throw new SisError("Lesson not found");
  if (slot.dayOfWeek !== dayOfWeekForISODate(dateISO)) throw new SisError("That lesson isn't on the timetable that day");
  return slot;
}

/** What the coordinator needs to decide: everyone who might cover, ranked, with reasons. */
async function candidateFacts(slot: Awaited<ReturnType<typeof loadSlot>>, dateISO: string, scope: CoverScope): Promise<CandidateFacts[]> {
  const date = utcDate(dateISO);
  const staff = await db.staff.findMany({
    where: {
      organizationId: scope.organizationId,
      deletedAt: null,
      exitDate: null,
      OR: [{ branchId: scope.branchId }, { branchId: null }],
      user: { status: "ACTIVE", deletedAt: null },
    },
    include: { user: { select: { name: true } } },
  });
  const ids = staff.map((s) => s.id);
  const [own, covering, onLeave, assignments, timetabled] = await Promise.all([
    db.timetableSlot.findMany({
      where: { staffId: { in: ids }, dayOfWeek: slot.dayOfWeek, section: { deletedAt: null, academicYear: { isCurrent: true } } },
      select: { staffId: true, startTime: true, endTime: true },
    }),
    // This lesson's own current cover is excluded: re-assigning it must not
    // count the present substitute as "busy with" the lesson being moved.
    db.substitution.findMany({ where: { date, substituteStaffId: { in: ids }, slotId: { not: slot.id } }, include: { slot: { select: { startTime: true, endTime: true } } } }),
    staffOnLeave(scope, date),
    db.subjectAssignment.findMany({
      where: { staffId: { in: ids }, OR: [{ subjectId: slot.subjectId }, { sectionId: slot.sectionId }] },
      select: { staffId: true, subjectId: true, sectionId: true },
    }),
    // A timetabled lesson counts as much as an assignment record: a teacher
    // who takes Grade 5 A for English every day knows Grade 5 A, whether or
    // not anyone filled in the teaching-assignments screen.
    db.timetableSlot.findMany({
      where: { staffId: { in: ids }, OR: [{ subjectId: slot.subjectId }, { sectionId: slot.sectionId }], section: { deletedAt: null, academicYear: { isCurrent: true } } },
      select: { staffId: true, subjectId: true, sectionId: true },
    }),
  ]);
  const teaching = [...assignments, ...timetabled];

  return staff.map((s) => ({
    staffId: s.id,
    name: s.user.name,
    ownLessons: own.filter((o) => o.staffId === s.id),
    covering: covering.filter((c) => c.substituteStaffId === s.id).map((c) => c.slot),
    onLeave: onLeave.has(s.id),
    teachesSubject: teaching.some((a) => a.staffId === s.id && a.subjectId === slot.subjectId),
    teachesSection: teaching.some((a) => a.staffId === s.id && a.sectionId === slot.sectionId),
  }));
}

export async function suggestSubstitutes(slotId: string, dateISO: string, scope: CoverScope) {
  const slot = await loadSlot(slotId, dateISO, scope);
  const target: LessonToCover = { startTime: slot.startTime, endTime: slot.endTime, subjectId: slot.subjectId, sectionId: slot.sectionId, absentStaffId: slot.staffId };
  const [facts, cover] = await Promise.all([
    candidateFacts(slot, dateISO, scope),
    db.substitution.findUnique({ where: { slotId_date: { slotId, date: utcDate(dateISO) } }, include: { substituteStaff: { include: { user: { select: { name: true } } } } } }),
  ]);
  return { slot, cover, ranked: rankSubstitutes(target, facts) };
}

const lessonLabel = (slot: Awaited<ReturnType<typeof loadSlot>>, dateISO: string) =>
  `${slot.section.grade.name} / ${slot.section.name} ${slot.subject.name}, ${dateISO} ${slot.startTime}–${slot.endTime}`;

/**
 * Arrange (or re-arrange) cover for one lesson.
 *
 * Availability is RE-CHECKED here against fresh data, not trusted from the
 * suggestion list the coordinator was looking at — a colleague may have given
 * the same teacher another lesson in the meantime. The check and the write
 * run under a transaction-scoped advisory lock on (substitute, date), so two
 * coordinators assigning one teacher to two overlapping lessons at the same
 * moment are serialised, and the second is refused rather than both winning.
 */
export async function assignSubstitute(
  input: { slotId: string; dateISO: string; substituteStaffId: string; reason?: string },
  scope: CoverScope & { todayISO: string },
  actor: Actor,
) {
  if (input.dateISO < scope.todayISO) throw new SisError("That day has gone — cover can only be arranged for today or later");
  const slot = await loadSlot(input.slotId, input.dateISO, scope);
  if (input.substituteStaffId === slot.staffId) throw new SisError(`${slot.staff.user.name} is the teacher who needs cover`);

  const substitute = await db.staff.findFirst({
    where: {
      id: input.substituteStaffId,
      organizationId: scope.organizationId,
      deletedAt: null,
      exitDate: null,
      OR: [{ branchId: scope.branchId }, { branchId: null }],
      user: { status: "ACTIVE", deletedAt: null },
    },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!substitute) throw new SisError("That member of staff can't be found at this branch, or no longer works here");

  const date = utcDate(input.dateISO);
  const target: LessonToCover = { startTime: slot.startTime, endTime: slot.endTime, subjectId: slot.subjectId, sectionId: slot.sectionId, absentStaffId: slot.staffId };

  const saved = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cover:${substitute.id}:${input.dateISO}`}))`;

      // Re-check THIS person only, on the transaction's own connection. The
      // first version re-ran the whole staff ranking here, on the shared
      // pool, while this transaction held one of its connections — and on a
      // slow morning it outlived the transaction timeout and nothing saved.
      const ownLessons = await tx.timetableSlot.findMany({
        where: { staffId: substitute.id, dayOfWeek: slot.dayOfWeek, section: { deletedAt: null, academicYear: { isCurrent: true } } },
        select: { startTime: true, endTime: true },
      });
      const covering = await tx.substitution.findMany({
        where: { date, substituteStaffId: substitute.id, slotId: { not: slot.id } },
        select: { slot: { select: { startTime: true, endTime: true } } },
      });
      const leave = await tx.leaveRequest.count({ where: { staffId: substitute.id, status: "APPROVED", fromDate: { lte: date }, toDate: { gte: date } } });

      const assessed = assessCandidate(target, {
        staffId: substitute.id,
        name: substitute.user.name,
        ownLessons,
        covering: covering.map((c) => c.slot),
        onLeave: leave > 0,
        teachesSubject: false,
        teachesSection: false,
      });
      if (!assessed.available) {
        throw new SisError(`${substitute.user.name} can't cover this lesson — ${assessed.blockers.map((b) => BLOCKER_LABELS[b]).join(", ")}`);
      }

      return tx.substitution.upsert({
        where: { slotId_date: { slotId: slot.id, date } },
        create: { slotId: slot.id, date, absentStaffId: slot.staffId, substituteStaffId: substitute.id, reason: input.reason ?? null, createdByUserId: actor.userId },
        update: { substituteStaffId: substitute.id, reason: input.reason ?? null, createdByUserId: actor.userId },
      });
    },
    // Headroom for a slow local engine; the work inside is now three indexed reads and a write.
    { timeout: 10_000 },
  );

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "substitution.arranged",
    resourceType: "timetable_slot",
    resourceId: slot.id,
    after: { date: input.dateISO, lesson: lessonLabel(slot, input.dateISO), absent: slot.staff.user.name, cover: substitute.user.name, reason: input.reason ?? null },
  });
  await notifyUser(substitute.user.id, "Cover arranged", `You're covering ${lessonLabel(slot, input.dateISO)} for ${slot.staff.user.name}. The lesson's register is yours to take.`);

  return saved;
}

export async function cancelSubstitution(substitutionId: string, scope: CoverScope, actor: Actor) {
  const cover = await db.substitution.findFirst({
    where: { id: substitutionId, slot: { section: { grade: { branchId: scope.branchId, branch: { organizationId: scope.organizationId } } } } },
    include: { slot: { include: slotInclude }, substituteStaff: { include: { user: { select: { id: true, name: true } } } } },
  });
  if (!cover) throw new SisError("That cover arrangement no longer exists");
  const dateISO = cover.date.toISOString().slice(0, 10);

  await db.substitution.delete({ where: { id: cover.id } });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "substitution.cancelled",
    resourceType: "timetable_slot",
    resourceId: cover.slotId,
    before: { date: dateISO, lesson: lessonLabel(cover.slot, dateISO), cover: cover.substituteStaff.user.name },
  });
  await notifyUser(cover.substituteStaff.user.id, "Cover cancelled", `You're no longer covering ${lessonLabel(cover.slot, dateISO)}.`);
}
