import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { DayOfWeek } from "@/generated/prisma/enums";
import { CONFLICT_LABELS, dayOfWeekFor, findConflicts, isValidTimeRange, type SlotLike } from "@/modules/academics/timetable-conflicts";
import { SisError, type Actor } from "@/modules/sis/students.service";

const slotInclude = {
  subject: true,
  staff: { include: { user: { select: { name: true } } } },
  section: { include: { grade: true } },
} as const;

export async function listSlotsForSection(sectionId: string, organizationId: string) {
  return db.timetableSlot.findMany({
    where: { sectionId, section: { grade: { branch: { organizationId } } } },
    include: slotInclude,
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });
}

export async function listSlotsForStaff(staffId: string) {
  return db.timetableSlot.findMany({
    where: { staffId, section: { deletedAt: null, academicYear: { isCurrent: true } } },
    include: slotInclude,
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });
}

export async function todaysSlotsForStaff(staffId: string, date = new Date()) {
  const day = dayOfWeekFor(date);
  return (await listSlotsForStaff(staffId)).filter((s) => s.dayOfWeek === day);
}

export interface CreateSlotInput {
  sectionId: string;
  subjectId: string;
  staffId: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  room?: string;
}

/**
 * Creates a slot only if it collides with nothing: the section's own
 * timetable, the teacher's other classes anywhere in the branch, and the
 * room if one is named (blueprint 11.4 conflict detection). The error lists
 * every collision so the scheduler can fix them all at once.
 */
export async function createSlot(input: CreateSlotInput, branchId: string, actor: Actor) {
  if (!isValidTimeRange(input.startTime, input.endTime)) throw new SisError("End time must be after start time");

  const [section, subject, staff] = await Promise.all([
    db.section.findFirst({
      where: { id: input.sectionId, deletedAt: null, grade: { branchId, deletedAt: null }, academicYear: { isCurrent: true, deletedAt: null } },
      include: { grade: true },
    }),
    db.subject.findFirst({ where: { id: input.subjectId, organizationId: actor.organizationId, deletedAt: null } }),
    db.staff.findFirst({ where: { id: input.staffId, organizationId: actor.organizationId, deletedAt: null } }),
  ]);
  if (!section) throw new SisError("That section isn't in this branch's current academic year");
  if (!subject) throw new SisError("Subject not found");
  if (!staff) throw new SisError("Staff member not found");

  const room = input.room?.trim() || null;
  const sameDay = await db.timetableSlot.findMany({
    where: {
      dayOfWeek: input.dayOfWeek,
      section: { grade: { branchId }, academicYear: { isCurrent: true } },
      OR: [{ sectionId: input.sectionId }, { staffId: input.staffId }, ...(room ? [{ room: { equals: room, mode: "insensitive" as const } }] : [])],
    },
    include: slotInclude,
  });

  const candidate: SlotLike = { ...input, room };
  const conflicts = findConflicts(candidate, sameDay);
  if (conflicts.length > 0) {
    const lines = conflicts.map((c) => {
      const w = c.with as (typeof sameDay)[number];
      return `${CONFLICT_LABELS[c.kind]}: ${w.section.grade.name} / ${w.section.name} ${w.subject.code} ${w.startTime}–${w.endTime}`;
    });
    throw new SisError(`Can't add this slot — ${lines.join("; ")}`);
  }

  const slot = await db.timetableSlot.create({
    data: {
      sectionId: input.sectionId,
      subjectId: input.subjectId,
      staffId: input.staffId,
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
      room,
    },
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "timetable.slot_created",
    resourceType: "section",
    resourceId: section.id,
    after: { section: `${section.grade.name} / ${section.name}`, subject: subject.code, day: input.dayOfWeek, time: `${input.startTime}–${input.endTime}`, room },
  });

  return slot;
}

export async function deleteSlot(id: string, actor: Actor) {
  const slot = await db.timetableSlot.findFirst({
    where: { id, section: { grade: { branch: { organizationId: actor.organizationId } } } },
    include: slotInclude,
  });
  if (!slot) throw new SisError("Slot not found");

  await db.timetableSlot.delete({ where: { id } });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "timetable.slot_removed",
    resourceType: "section",
    resourceId: slot.sectionId,
    before: { section: `${slot.section.grade.name} / ${slot.section.name}`, subject: slot.subject.code, day: slot.dayOfWeek, time: `${slot.startTime}–${slot.endTime}` },
  });
}
