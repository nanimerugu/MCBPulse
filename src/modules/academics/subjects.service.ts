import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { CurriculumType } from "@/generated/prisma/enums";
import { SisError, type Actor } from "@/modules/sis/students.service";

export async function listSubjects(organizationId: string) {
  return db.subject.findMany({
    where: { organizationId, deletedAt: null },
    include: { _count: { select: { subjectAssignments: true, timetableSlots: true } } },
    orderBy: { name: "asc" },
  });
}

export async function createSubject(input: { name: string; code: string }, actor: Actor) {
  const clash = await db.subject.findFirst({ where: { organizationId: actor.organizationId, code: input.code } });
  if (clash) throw new SisError(`Subject code ${input.code} is already in use${clash.deletedAt ? " by an archived subject" : ""}`);

  const subject = await db.subject.create({ data: { organizationId: actor.organizationId, name: input.name, code: input.code } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "subject.created",
    resourceType: "subject",
    resourceId: subject.id,
    after: { name: subject.name, code: subject.code },
  });
  return subject;
}

export async function listCurricula(organizationId: string) {
  return db.curriculum.findMany({ where: { organizationId, deletedAt: null }, orderBy: { name: "asc" } });
}

export async function createCurriculum(input: { name: string; type: CurriculumType }, actor: Actor) {
  const clash = await db.curriculum.findFirst({ where: { organizationId: actor.organizationId, name: input.name, deletedAt: null } });
  if (clash) throw new SisError(`Curriculum "${input.name}" already exists`);

  const curriculum = await db.curriculum.create({ data: { organizationId: actor.organizationId, name: input.name, type: input.type } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "curriculum.created",
    resourceType: "curriculum",
    resourceId: curriculum.id,
    after: { name: curriculum.name, type: curriculum.type },
  });
  return curriculum;
}
