import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { Prisma } from "@/generated/prisma/client";
import type { StudentStatus } from "@/generated/prisma/enums";
import {
  ACTIONS_CLEARING_SECTION,
  ACTIONS_REQUIRING_SECTION,
  nextStatus,
  type LifecycleAction,
} from "@/modules/sis/lifecycle";
import type { StudentInput } from "@/modules/sis/schemas";

/**
 * Student service. Authorization is the caller's job (page/action layer runs
 * `authorize()`); this layer's own guard is tenant ownership — every read
 * and write is pinned to an organizationId so an id from another tenant is
 * a not-found, never a leak.
 */

export class SisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SisError";
  }
}

export interface Actor {
  userId: string;
  organizationId: string;
}

export interface StudentListQuery {
  organizationId: string;
  branchId: string;
  q?: string;
  status?: StudentStatus;
  sectionId?: string;
  page?: number;
}

export const STUDENT_PAGE_SIZE = 50;

export async function listStudents(query: StudentListQuery) {
  const page = Math.max(1, query.page ?? 1);
  const q = query.q?.trim();

  const where: Prisma.StudentWhereInput = {
    organizationId: query.organizationId,
    branchId: query.branchId,
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.sectionId ? { currentSectionId: query.sectionId } : {}),
    ...(q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { admissionNumber: { contains: q, mode: "insensitive" } },
            // Blueprint 11.1: "search by ... parent phone"
            { guardianLinks: { some: { guardian: { phone: { contains: q } } } } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    db.student.count({ where }),
    db.student.findMany({
      where,
      include: {
        currentSection: { include: { grade: true } },
        guardianLinks: { where: { isPrimary: true }, include: { guardian: true }, take: 1 },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (page - 1) * STUDENT_PAGE_SIZE,
      take: STUDENT_PAGE_SIZE,
    }),
  ]);

  return { items, total, page, pageSize: STUDENT_PAGE_SIZE, pageCount: Math.max(1, Math.ceil(total / STUDENT_PAGE_SIZE)) };
}

export async function getStudent360(studentId: string, organizationId: string) {
  const student = await db.student.findFirst({
    where: { id: studentId, organizationId, deletedAt: null },
    include: {
      branch: true,
      currentSection: { include: { grade: true, academicYear: true } },
      guardianLinks: { include: { guardian: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      emergencyContacts: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!student) return null;

  const timeline = await db.auditEvent.findMany({
    where: { organizationId, resourceType: "student", resourceId: studentId },
    include: { actorUser: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return { student, timeline };
}

function toDate(iso: string | undefined): Date | null {
  return iso ? new Date(`${iso}T00:00:00.000Z`) : null;
}

export async function createStudent(input: StudentInput, scope: { branchId: string }, actor: Actor) {
  const existing = await db.student.findFirst({
    where: { organizationId: actor.organizationId, admissionNumber: input.admissionNumber },
    select: { id: true, deletedAt: true },
  });
  if (existing) {
    throw new SisError(
      existing.deletedAt
        ? `Admission number ${input.admissionNumber} belongs to an archived student`
        : `Admission number ${input.admissionNumber} is already in use`,
    );
  }

  const student = await db.student.create({
    data: {
      organizationId: actor.organizationId,
      branchId: scope.branchId,
      admissionNumber: input.admissionNumber,
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: toDate(input.dateOfBirth),
      gender: input.gender ?? null,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      postalCode: input.postalCode ?? null,
      bloodGroup: input.bloodGroup ?? null,
      medicalNotes: input.medicalNotes ?? null,
    },
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "student.created",
    resourceType: "student",
    resourceId: student.id,
    after: { admissionNumber: student.admissionNumber, name: `${student.firstName} ${student.lastName}`, status: student.status },
  });

  return student;
}

export async function updateStudent(studentId: string, input: StudentInput, actor: Actor) {
  const before = await db.student.findFirst({ where: { id: studentId, organizationId: actor.organizationId, deletedAt: null } });
  if (!before) throw new SisError("Student not found");

  if (input.admissionNumber !== before.admissionNumber) {
    const clash = await db.student.findFirst({
      where: { organizationId: actor.organizationId, admissionNumber: input.admissionNumber, NOT: { id: studentId } },
      select: { id: true },
    });
    if (clash) throw new SisError(`Admission number ${input.admissionNumber} is already in use`);
  }

  const after = await db.student.update({
    where: { id: studentId },
    data: {
      admissionNumber: input.admissionNumber,
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: toDate(input.dateOfBirth),
      gender: input.gender ?? null,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      postalCode: input.postalCode ?? null,
      bloodGroup: input.bloodGroup ?? null,
      medicalNotes: input.medicalNotes ?? null,
    },
  });

  // Audit only what changed, so the timeline reads as a diff, not a dump.
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(input) as (keyof StudentInput)[]) {
    const b = before[key as keyof typeof before];
    const a = after[key as keyof typeof after];
    const bs = b instanceof Date ? b.toISOString().slice(0, 10) : b;
    const as = a instanceof Date ? a.toISOString().slice(0, 10) : a;
    if (bs !== as) changed[key] = { from: bs ?? null, to: as ?? null };
  }

  if (Object.keys(changed).length > 0) {
    await recordAuditEvent({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "student.updated",
      resourceType: "student",
      resourceId: studentId,
      before: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.from])),
      after: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.to])),
    });
  }

  return after;
}

export async function archiveStudent(studentId: string, actor: Actor) {
  const student = await db.student.findFirst({ where: { id: studentId, organizationId: actor.organizationId, deletedAt: null } });
  if (!student) throw new SisError("Student not found");
  if (student.status === "ENROLLED") throw new SisError("Withdraw or transfer an enrolled student before archiving");

  await db.student.update({ where: { id: studentId }, data: { deletedAt: new Date(), currentSectionId: null } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "student.archived",
    resourceType: "student",
    resourceId: studentId,
    before: { status: student.status },
  });
}

export interface LifecycleInput {
  action: LifecycleAction;
  sectionId?: string;
  note?: string;
}

/**
 * Every enrollment change goes through here. The state machine decides if
 * the transition exists; this function checks the section is real, in this
 * org/branch, and in the current academic year, then records before/after.
 */
export async function applyLifecycleAction(studentId: string, input: LifecycleInput, actor: Actor) {
  const student = await db.student.findFirst({
    where: { id: studentId, organizationId: actor.organizationId, deletedAt: null },
    include: { currentSection: { include: { grade: true } } },
  });
  if (!student) throw new SisError("Student not found");

  const to = nextStatus(student.status, input.action);
  if (!to) throw new SisError(`Cannot ${input.action} a student whose status is ${student.status}`);

  let sectionId: string | null = student.currentSectionId;
  let sectionLabel: string | null = student.currentSection
    ? `${student.currentSection.grade.name} / ${student.currentSection.name}`
    : null;

  if (ACTIONS_REQUIRING_SECTION.has(input.action)) {
    if (!input.sectionId) throw new SisError("Choose a section");
    const section = await db.section.findFirst({
      where: {
        id: input.sectionId,
        deletedAt: null,
        grade: { branchId: student.branchId, deletedAt: null },
        academicYear: { isCurrent: true, deletedAt: null },
      },
      include: { grade: true },
    });
    if (!section) throw new SisError("That section isn't in this branch's current academic year");
    if (input.action === "promote" && student.currentSection && section.grade.sequence < student.currentSection.grade.sequence) {
      throw new SisError("Promotion can't move a student to a lower grade — use transfer/withdraw and re-enroll for that");
    }
    sectionId = section.id;
    sectionLabel = `${section.grade.name} / ${section.name}`;
  } else if (ACTIONS_CLEARING_SECTION.has(input.action)) {
    sectionId = null;
    sectionLabel = null;
  }

  const updated = await db.student.update({
    where: { id: studentId },
    data: {
      status: to,
      currentSectionId: sectionId,
      ...(input.action === "enroll" && !student.admissionDate ? { admissionDate: new Date() } : {}),
    },
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: `student.${input.action}`,
    resourceType: "student",
    resourceId: studentId,
    before: {
      status: student.status,
      section: student.currentSection ? `${student.currentSection.grade.name} / ${student.currentSection.name}` : null,
    },
    after: { status: to, section: sectionLabel, ...(input.note ? { note: input.note } : {}) },
  });

  return updated;
}

/** Sections a lifecycle form can offer: current academic year of the student's branch. */
export async function listEnrollableSections(branchId: string) {
  return db.section.findMany({
    where: { deletedAt: null, grade: { branchId, deletedAt: null }, academicYear: { isCurrent: true, deletedAt: null } },
    include: { grade: true },
    orderBy: [{ grade: { sequence: "asc" } }, { name: "asc" }],
  });
}
