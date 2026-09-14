import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { LMS_FLAG } from "@/modules/sis/access";
import { deriveSubmissionStatus, isLate } from "@/modules/lms/grading";
import { uploadFile } from "@/modules/files/files.service";
import { SisError } from "@/modules/sis/students.service";
import type { PortalScope } from "@/modules/portal/scope";

/**
 * Students handing in their own work — the portal's FIRST write.
 *
 * Everything else in the portal is read-only, and this stays as close to
 * that as a write can get. The rules:
 *
 *  - Only a STUDENT may submit, never a parent. A parent can see the marks;
 *    handing in the work is not theirs to do, and a system that lets them
 *    is one a teacher cannot trust.
 *  - Only for an assignment published to the student's OWN section, resolved
 *    from their record rather than from the form.
 *  - Never after a teacher has graded it. A student must not be able to
 *    replace the work a mark was given for.
 *  - Late is recorded, not refused. Whether a late hand-in is accepted is a
 *    teacher's decision, and the derived status already says it was late.
 */

export interface SubmitInput {
  assignmentId: string;
  responseText?: string;
  file?: { fileName: string; mimeType: string; bytes: Buffer };
}

export async function listOwnAssignments(scope: PortalScope, studentId: string) {
  if (!(await isFeatureEnabled(LMS_FLAG, scope.organizationId))) return null;

  const student = await db.student.findFirst({ where: { id: studentId, organizationId: scope.organizationId }, select: { currentSectionId: true } });
  if (!student?.currentSectionId) return [];

  const assignments = await db.assignment.findMany({
    where: { sectionId: student.currentSectionId, publishedAt: { not: null } },
    include: {
      course: { include: { subject: true } },
      submissions: { where: { studentId }, include: { fileAsset: true } },
    },
    orderBy: { dueAt: "desc" },
    take: 30,
  });

  const now = new Date();
  return assignments.map((a) => {
    const submission = a.submissions[0] ?? null;
    return {
      id: a.id,
      title: a.title,
      instructions: a.instructions,
      subject: a.course?.subject?.name ?? null,
      dueAt: a.dueAt,
      maxMarks: a.maxMarks,
      submission,
      status: deriveSubmissionStatus({
        submittedAt: submission?.submittedAt ?? null,
        dueAt: a.dueAt,
        marksAwarded: submission?.marksAwarded ?? null,
      }),
      // A graded piece is closed; anything else can still be handed in or replaced.
      canSubmit: submission?.marksAwarded === null || submission === null,
      wouldBeLate: isLate(now, a.dueAt),
    };
  });
}

export async function submitOwnWork(input: SubmitInput, scope: PortalScope, studentId: string) {
  if (scope.kind !== "student") throw new SisError("Only the student can hand in their own work");
  if (!(await isFeatureEnabled(LMS_FLAG, scope.organizationId))) throw new SisError("Learning is not switched on at this school");

  const student = await db.student.findFirst({
    where: { id: studentId, organizationId: scope.organizationId, deletedAt: null },
    select: { id: true, currentSectionId: true, firstName: true, lastName: true },
  });
  if (!student?.currentSectionId) throw new SisError("You aren't in a section, so there is nothing to hand in");

  // The assignment must be published AND belong to this student's own
  // section — the section comes from their record, never from the form.
  const assignment = await db.assignment.findFirst({
    where: { id: input.assignmentId, sectionId: student.currentSectionId, publishedAt: { not: null } },
  });
  if (!assignment) throw new SisError("That assignment isn't one of yours");

  const existing = await db.submission.findUnique({
    where: { assignmentId_studentId: { assignmentId: assignment.id, studentId } },
  });
  if (existing?.marksAwarded !== null && existing?.marksAwarded !== undefined) {
    throw new SisError("This has already been marked — talk to your teacher if something needs changing");
  }

  const hasText = (input.responseText ?? "").trim().length > 0;
  if (!hasText && !input.file) throw new SisError("Write something or attach a file");

  let fileAssetId = existing?.fileAssetId ?? null;
  if (input.file) {
    // Reuses the Files module's validation wholesale, so a student cannot
    // upload anything a member of staff couldn't.
    const { asset } = await uploadFile(
      { fileName: input.file.fileName, mimeType: input.file.mimeType, bytes: input.file.bytes, classification: "internal" },
      { organizationId: scope.organizationId, branchId: "" },
      { userId: scope.viewer.userId, organizationId: scope.organizationId },
    );
    fileAssetId = asset.id;
  }

  const submittedAt = new Date();
  const submission = await db.submission.upsert({
    where: { assignmentId_studentId: { assignmentId: assignment.id, studentId } },
    create: {
      assignmentId: assignment.id,
      studentId,
      status: isLate(submittedAt, assignment.dueAt) ? "LATE" : "SUBMITTED",
      submittedAt,
      responseText: hasText ? input.responseText!.trim() : null,
      submittedByStudent: true,
      fileAssetId,
    },
    update: {
      status: isLate(submittedAt, assignment.dueAt) ? "LATE" : "SUBMITTED",
      submittedAt,
      responseText: hasText ? input.responseText!.trim() : existing?.responseText ?? null,
      submittedByStudent: true,
      fileAssetId,
      // The teacher's optimistic lock still applies to grading; bumping it
      // here means a grader holding a stale version is told to re-read.
      version: { increment: 1 },
    },
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: scope.viewer.userId,
    action: "submission.handed_in",
    resourceType: "assignment",
    resourceId: assignment.id,
    after: {
      submissionId: submission.id,
      student: `${student.firstName} ${student.lastName}`,
      late: isLate(submittedAt, assignment.dueAt),
      hasFile: fileAssetId !== null,
      replaced: existing !== null,
    },
  });

  return { late: isLate(submittedAt, assignment.dueAt), replaced: existing !== null };
}
