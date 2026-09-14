import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * Courses are an organization-wide catalog (like Subjects): "Mathematics,
 * Grade 5" exists once and every section that teaches it points at the same
 * content. Assignments are what target a particular section — that split is
 * what stops content being copy-pasted per class.
 */

export async function listCourses(organizationId: string, filters: { subjectId?: string; gradeId?: string } = {}) {
  return db.course.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
      ...(filters.gradeId ? { gradeId: filters.gradeId } : {}),
    },
    include: {
      subject: true,
      grade: true,
      curriculum: true,
      _count: { select: { modules: true, assignments: true } },
    },
    orderBy: [{ grade: { sequence: "asc" } }, { title: "asc" }],
  });
}

export async function getCourse(courseId: string, organizationId: string) {
  return db.course.findFirst({
    where: { id: courseId, organizationId, deletedAt: null },
    include: {
      subject: true,
      grade: true,
      curriculum: true,
      modules: {
        orderBy: { sequence: "asc" },
        include: { lessons: { orderBy: { sequence: "asc" }, include: { resources: true } } },
      },
      assignments: { orderBy: { dueAt: "desc" }, include: { section: { include: { grade: true } } } },
    },
  });
}

export async function createCourse(
  input: { title: string; description?: string; subjectId?: string; gradeId?: string; curriculumId?: string },
  branchId: string,
  actor: Actor,
) {
  if (input.subjectId) {
    const s = await db.subject.findFirst({ where: { id: input.subjectId, organizationId: actor.organizationId, deletedAt: null } });
    if (!s) throw new SisError("Subject not found");
  }
  if (input.gradeId) {
    const g = await db.grade.findFirst({ where: { id: input.gradeId, branchId, deletedAt: null } });
    if (!g) throw new SisError("Grade not found in this branch");
  }
  if (input.curriculumId) {
    const c = await db.curriculum.findFirst({ where: { id: input.curriculumId, organizationId: actor.organizationId, deletedAt: null } });
    if (!c) throw new SisError("Curriculum not found");
  }

  const course = await db.course.create({
    data: {
      organizationId: actor.organizationId,
      title: input.title,
      description: input.description ?? null,
      subjectId: input.subjectId ?? null,
      gradeId: input.gradeId ?? null,
      curriculumId: input.curriculumId ?? null,
    },
    include: { subject: true, grade: true },
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "course.created",
    resourceType: "course",
    resourceId: course.id,
    after: { title: course.title, subject: course.subject?.code ?? null, grade: course.grade?.name ?? null },
  });
  return course;
}

/** Sequence is assigned, not chosen — modules are ordered by when they were added. */
export async function addModule(courseId: string, title: string, actor: Actor) {
  const course = await db.course.findFirst({ where: { id: courseId, organizationId: actor.organizationId, deletedAt: null } });
  if (!course) throw new SisError("Course not found");
  const last = await db.courseModule.findFirst({ where: { courseId }, orderBy: { sequence: "desc" } });
  const mod = await db.courseModule.create({ data: { courseId, title, sequence: (last?.sequence ?? 0) + 1 } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "course.module_added",
    resourceType: "course",
    resourceId: courseId,
    after: { title, sequence: mod.sequence },
  });
  return mod;
}

export async function addLesson(input: { courseModuleId: string; title: string; content?: string }, actor: Actor) {
  const mod = await db.courseModule.findFirst({
    where: { id: input.courseModuleId, course: { organizationId: actor.organizationId, deletedAt: null } },
    include: { course: { select: { id: true } } },
  });
  if (!mod) throw new SisError("Module not found");
  const last = await db.lesson.findFirst({ where: { courseModuleId: input.courseModuleId }, orderBy: { sequence: "desc" } });
  const lesson = await db.lesson.create({
    data: { courseModuleId: input.courseModuleId, title: input.title, content: input.content ?? null, sequence: (last?.sequence ?? 0) + 1 },
  });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "course.lesson_added",
    resourceType: "course",
    resourceId: mod.course.id,
    after: { module: mod.title, title: input.title, sequence: lesson.sequence },
  });
  return lesson;
}
