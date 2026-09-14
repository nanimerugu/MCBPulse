import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { Prisma } from "@/generated/prisma/client";
import { MARK_PROBLEM_MESSAGES, deriveSubmissionStatus, isLate, summarizeRow, validateMark, type GradebookCell } from "@/modules/lms/grading";
import type { AssignmentInput } from "@/modules/lms/schemas";
import { SisError, type Actor } from "@/modules/sis/students.service";

const assignmentInclude = {
  course: { include: { subject: true } },
  section: { include: { grade: true } },
  createdByStaff: { include: { user: { select: { name: true } } } },
  _count: { select: { submissions: true } },
} satisfies Prisma.AssignmentInclude;

/**
 * Assignments for the sections a viewer may see. `sectionIds === null` means
 * unrestricted (an admin); an array restricts to a teacher's own sections
 * (the attribute policy from Phase 2), and an empty array therefore matches
 * nothing — which is the correct answer for a teacher with no classes.
 */
export async function listAssignments(args: { organizationId: string; branchId: string; sectionIds: string[] | null; sectionId?: string; includeDrafts: boolean }) {
  return db.assignment.findMany({
    where: {
      course: { organizationId: args.organizationId },
      section: { grade: { branchId: args.branchId } },
      ...(args.sectionId ? { sectionId: args.sectionId } : args.sectionIds ? { sectionId: { in: args.sectionIds } } : {}),
      ...(args.includeDrafts ? {} : { publishedAt: { not: null } }),
    },
    include: assignmentInclude,
    orderBy: [{ dueAt: "desc" }],
    take: 200,
  });
}

export interface RosterRow {
  studentId: string;
  admissionNumber: string;
  name: string;
  submissionId: string | null;
  submittedAt: Date | null;
  marksAwarded: number | null;
  feedback: string;
  version: number | null;
  wasLate: boolean;
  /** What the student wrote, when they handed in through the portal. */
  responseText: string | null;
  /** Their attachment, so the teacher can read what they are marking. */
  fileAssetId: string | null;
  fileName: string | null;
  submittedByStudent: boolean;
}

/**
 * The grading roster: every enrolled student in the assignment's section,
 * with their submission if one exists. Students without a Submission row
 * appear as blanks rather than being missing — the teacher grades the class,
 * not the rows that happen to exist.
 */
export async function getAssignmentRoster(assignmentId: string, organizationId: string) {
  const assignment = await db.assignment.findFirst({
    where: { id: assignmentId, course: { organizationId } },
    include: { ...assignmentInclude, submissions: { include: { fileAsset: true } } },
  });
  if (!assignment) return null;
  if (!assignment.sectionId) return { assignment, rows: [] as RosterRow[] };

  const students = await db.student.findMany({
    where: { currentSectionId: assignment.sectionId, status: "ENROLLED", deletedAt: null },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: { id: true, admissionNumber: true, firstName: true, lastName: true },
  });

  const rows: RosterRow[] = students.map((s) => {
    const sub = assignment.submissions.find((x) => x.studentId === s.id);
    return {
      studentId: s.id,
      admissionNumber: s.admissionNumber,
      name: `${s.firstName} ${s.lastName}`.trim(),
      submissionId: sub?.id ?? null,
      submittedAt: sub?.submittedAt ?? null,
      marksAwarded: sub?.marksAwarded ?? null,
      feedback: sub?.feedback ?? "",
      version: sub?.version ?? null,
      wasLate: isLate(sub?.submittedAt ?? null, assignment.dueAt),
      responseText: sub?.responseText ?? null,
      fileAssetId: sub?.fileAssetId ?? null,
      fileName: sub?.fileAsset?.fileName ?? null,
      submittedByStudent: sub?.submittedByStudent ?? false,
    };
  });

  return { assignment, rows };
}

export async function createAssignment(input: AssignmentInput, opts: { branchId: string; staffId: string | null }, actor: Actor) {
  const [course, section] = await Promise.all([
    db.course.findFirst({ where: { id: input.courseId, organizationId: actor.organizationId, deletedAt: null } }),
    db.section.findFirst({
      where: { id: input.sectionId, deletedAt: null, grade: { branchId: opts.branchId, deletedAt: null }, academicYear: { isCurrent: true, deletedAt: null } },
      include: { grade: true },
    }),
  ]);
  if (!course) throw new SisError("Course not found");
  if (!section) throw new SisError("That section isn't in this branch's current academic year");

  const assignment = await db.assignment.create({
    data: {
      courseId: input.courseId,
      sectionId: input.sectionId,
      createdByStaffId: opts.staffId,
      title: input.title,
      instructions: input.instructions ?? null,
      dueAt: new Date(`${input.dueAt}:00.000Z`),
      maxMarks: input.maxMarks,
    },
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "assignment.created",
    resourceType: "assignment",
    resourceId: assignment.id,
    after: { title: input.title, course: course.title, section: `${section.grade.name} / ${section.name}`, dueAt: input.dueAt, maxMarks: input.maxMarks },
  });
  return assignment;
}

async function requireAssignment(assignmentId: string, organizationId: string) {
  const assignment = await db.assignment.findFirst({
    where: { id: assignmentId, course: { organizationId } },
    include: { section: { include: { grade: true } }, _count: { select: { submissions: true } } },
  });
  if (!assignment) throw new SisError("Assignment not found");
  return assignment;
}

export async function publishAssignment(assignmentId: string, actor: Actor) {
  const assignment = await requireAssignment(assignmentId, actor.organizationId);
  if (assignment.publishedAt) throw new SisError("Already published");
  await db.assignment.update({ where: { id: assignmentId }, data: { publishedAt: new Date() } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "assignment.published",
    resourceType: "assignment",
    resourceId: assignmentId,
    after: { title: assignment.title, section: assignment.section ? `${assignment.section.grade.name} / ${assignment.section.name}` : null },
  });
}

/** Only an unpublished assignment with no submissions can be deleted. */
export async function deleteAssignment(assignmentId: string, actor: Actor) {
  const assignment = await requireAssignment(assignmentId, actor.organizationId);
  if (assignment.publishedAt) throw new SisError("A published assignment can't be deleted — students have seen it");
  if (assignment._count.submissions > 0) throw new SisError("This assignment already has submissions");
  await db.assignment.delete({ where: { id: assignmentId } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "assignment.deleted",
    resourceType: "assignment",
    resourceId: assignmentId,
    before: { title: assignment.title },
  });
}

export interface GradeEntry {
  studentId: string;
  /** yyyy-mm-dd, or "" to clear the submission entirely. */
  submittedOn: string;
  marks: number | null;
  feedback: string;
  version: number | null;
}

/**
 * Records submissions and marks for a whole roster in one pass. Each row is
 * validated (a mark can't exceed the maximum, and work nobody handed in
 * can't be graded), and each existing row is updated under an optimistic
 * lock — two teachers grading the same class at once is exactly the
 * high-conflict case section 9 warns about.
 */
export async function saveGrades(assignmentId: string, entries: GradeEntry[], opts: { staffId: string | null }, actor: Actor) {
  const assignment = await requireAssignment(assignmentId, actor.organizationId);
  if (!assignment.publishedAt) throw new SisError("Publish the assignment before grading it");
  if (!assignment.sectionId) throw new SisError("This assignment has no section");

  const enrolled = new Set(
    (await db.student.findMany({ where: { currentSectionId: assignment.sectionId, status: "ENROLLED", deletedAt: null }, select: { id: true } })).map((s) => s.id),
  );

  // Validate everything before writing anything: a half-saved roster is
  // worse than a rejected one.
  for (const e of entries) {
    if (!enrolled.has(e.studentId)) throw new SisError("A student on this roster is no longer enrolled in the section — reload");
    const submittedAt = e.submittedOn ? new Date(`${e.submittedOn}T12:00:00.000Z`) : null;
    const problem = validateMark({ marks: e.marks, maxMarks: assignment.maxMarks, submittedAt });
    if (problem) throw new SisError(`${MARK_PROBLEM_MESSAGES[problem]} (out of ${assignment.maxMarks})`);
  }

  const result = await db.$transaction(async (tx) => {
    let changed = 0;
    for (const e of entries) {
      const submittedAt = e.submittedOn ? new Date(`${e.submittedOn}T12:00:00.000Z`) : null;
      const status = deriveSubmissionStatus({ submittedAt, dueAt: assignment.dueAt, marksAwarded: e.marks });
      const existing = await tx.submission.findUnique({ where: { assignmentId_studentId: { assignmentId, studentId: e.studentId } } });

      if (!existing) {
        // Nothing to record and nothing recorded: skip rather than writing empty rows.
        if (!submittedAt && e.marks === null && !e.feedback.trim()) continue;
        await tx.submission.create({
          data: {
            assignmentId,
            studentId: e.studentId,
            status,
            submittedAt,
            marksAwarded: e.marks,
            feedback: e.feedback.trim() || null,
            ...(e.marks !== null ? { gradedAt: new Date(), gradedByStaffId: opts.staffId } : {}),
          },
        });
        changed++;
        continue;
      }

      const unchanged =
        existing.marksAwarded === e.marks &&
        (existing.feedback ?? "") === e.feedback.trim() &&
        (existing.submittedAt?.toISOString().slice(0, 10) ?? "") === e.submittedOn;
      if (unchanged) continue;

      const { count } = await tx.submission.updateMany({
        where: { id: existing.id, version: e.version ?? existing.version },
        data: {
          status,
          submittedAt,
          marksAwarded: e.marks,
          feedback: e.feedback.trim() || null,
          version: { increment: 1 },
          ...(e.marks !== null ? { gradedAt: new Date(), gradedByStaffId: opts.staffId } : { gradedAt: null, gradedByStaffId: null }),
        },
      });
      if (count === 0) throw new SisError("Someone else graded this assignment while you were editing — reload and try again");
      changed++;
    }
    return changed;
  });

  const graded = entries.filter((e) => e.marks !== null).length;
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "assignment.graded",
    resourceType: "assignment",
    resourceId: assignmentId,
    after: { title: assignment.title, changed: result, graded, outOf: assignment.maxMarks },
  });

  return { changed: result };
}

export interface GradebookResult {
  assignments: { id: string; title: string; maxMarks: number; dueAt: Date }[];
  rows: {
    studentId: string;
    admissionNumber: string;
    name: string;
    cells: (GradebookCell & { assignmentId: string })[];
    totals: ReturnType<typeof summarizeRow>;
  }[];
}

/** The section's gradebook: published assignments as columns, enrolled students as rows. */
export async function getGradebook(sectionId: string, organizationId: string): Promise<GradebookResult> {
  const [assignments, students] = await Promise.all([
    db.assignment.findMany({
      where: { sectionId, publishedAt: { not: null }, course: { organizationId } },
      orderBy: { dueAt: "asc" },
      include: { submissions: true },
    }),
    db.student.findMany({
      where: { currentSectionId: sectionId, status: "ENROLLED", deletedAt: null, organizationId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, admissionNumber: true, firstName: true, lastName: true },
    }),
  ]);

  const rows = students.map((s) => {
    const cells = assignments.map((a) => {
      const sub = a.submissions.find((x) => x.studentId === s.id);
      return {
        assignmentId: a.id,
        marksAwarded: sub?.marksAwarded ?? null,
        maxMarks: a.maxMarks,
        status: sub?.status ?? ("PENDING" as const),
      };
    });
    return { studentId: s.id, admissionNumber: s.admissionNumber, name: `${s.firstName} ${s.lastName}`.trim(), cells, totals: summarizeRow(cells) };
  });

  return { assignments: assignments.map((a) => ({ id: a.id, title: a.title, maxMarks: a.maxMarks, dueAt: a.dueAt })), rows };
}

/**
 * Published assignments still ahead of their due date, for dashboards.
 * `sectionIds === null` means every section in the branch; an empty array
 * means the viewer teaches nothing and so has nothing due. The "still
 * ahead" comparison lives here rather than in a component because reading
 * the clock during render is impure — and because the database can filter
 * it far more cheaply than fetching everything and discarding most of it.
 */
export async function listUpcoming(args: { organizationId: string; branchId: string; sectionIds: string[] | null; take?: number }) {
  if (args.sectionIds !== null && args.sectionIds.length === 0) return [];
  return db.assignment.findMany({
    where: {
      publishedAt: { not: null },
      dueAt: { gte: new Date() },
      course: { organizationId: args.organizationId },
      section: { grade: { branchId: args.branchId } },
      ...(args.sectionIds ? { sectionId: { in: args.sectionIds } } : {}),
    },
    include: { section: { include: { grade: true } }, course: { select: { title: true } }, _count: { select: { submissions: true } } },
    orderBy: { dueAt: "asc" },
    take: args.take ?? 5,
  });
}
