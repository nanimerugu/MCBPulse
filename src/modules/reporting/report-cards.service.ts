import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { summarize } from "@/modules/academics/attendance-summary";
import { bandFor, checkScale, DEFAULT_BANDS, describeBandProblem, type Band } from "@/modules/reporting/grading-scale";
import { overallResult, subjectResult, weightsOf, type Weights } from "@/modules/reporting/weighting";
import { SisError, type Actor } from "@/modules/sis/students.service";

export interface ReportScope {
  organizationId: string;
  branchId: string;
}

// --- Grading scales ----------------------------------------------------------

export async function listScales(organizationId: string) {
  return db.gradingScale.findMany({
    where: { organizationId, deletedAt: null },
    include: { bands: { orderBy: { minPercent: "desc" } }, _count: { select: { reportCards: true } } },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

export async function defaultScale(organizationId: string) {
  return (
    (await db.gradingScale.findFirst({
      where: { organizationId, isDefault: true, deletedAt: null },
      include: { bands: true },
    })) ??
    (await db.gradingScale.findFirst({ where: { organizationId, deletedAt: null }, include: { bands: true } }))
  );
}

export async function createScale(input: { name: string; bands: Band[]; isDefault: boolean; weights: Weights | null }, scope: ReportScope, actor: Actor) {
  const problem = checkScale(input.bands);
  if (problem) throw new SisError(describeBandProblem(problem));
  if (input.weights && input.weights.exam + input.weights.coursework !== 100) throw new SisError("Weights must add up to 100");

  const clash = await db.gradingScale.findFirst({ where: { organizationId: scope.organizationId, name: input.name, deletedAt: null } });
  if (clash) throw new SisError(`A scale called "${input.name}" already exists`);

  const scale = await db.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.gradingScale.updateMany({ where: { organizationId: scope.organizationId }, data: { isDefault: false } });
    }
    return tx.gradingScale.create({
      data: {
        organizationId: scope.organizationId,
        name: input.name,
        isDefault: input.isDefault,
        examWeight: input.weights?.exam ?? null,
        courseworkWeight: input.weights?.coursework ?? null,
        bands: { create: input.bands.map((b) => ({ label: b.label, minPercent: b.minPercent, description: b.description ?? null })) },
      },
    });
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "grading_scale.created",
    resourceType: "grading_scale",
    resourceId: scale.id,
    after: { name: input.name, bands: input.bands.length, isDefault: input.isDefault, weights: input.weights },
  });
  return scale;
}

/**
 * Which scale NEW reports use. Reports already generated keep the scale and
 * the weighting they were made with — switching the default never rewrites a
 * report a family has seen.
 */
export async function setDefaultScale(scaleId: string, scope: ReportScope, actor: Actor) {
  const scale = await db.gradingScale.findFirst({ where: { id: scaleId, organizationId: scope.organizationId, deletedAt: null } });
  if (!scale) throw new SisError("Grading scale not found");
  if (scale.isDefault) return;

  await db.$transaction([
    db.gradingScale.updateMany({ where: { organizationId: scope.organizationId }, data: { isDefault: false } }),
    db.gradingScale.update({ where: { id: scaleId }, data: { isDefault: true } }),
  ]);
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "grading_scale.made_default",
    resourceType: "grading_scale",
    resourceId: scaleId,
    after: { name: scale.name },
  });
}

/**
 * Always returns a scale WITH its bands. A school that has never configured
 * one gets the CBSE-style default rather than a report card with no grades
 * on it — the scale is then theirs to edit.
 */
export async function ensureDefaultScale(scope: ReportScope, actor: Actor) {
  const existing = await defaultScale(scope.organizationId);
  if (existing) return existing;
  const created = await createScale({ name: "Standard (CBSE-style)", bands: DEFAULT_BANDS, isDefault: true, weights: null }, scope, actor);
  return db.gradingScale.findUniqueOrThrow({ where: { id: created.id }, include: { bands: true } });
}

// --- Report cards ------------------------------------------------------------

export async function listReportCards(scope: ReportScope, opts: { sectionId?: string; term?: string } = {}) {
  return db.reportCard.findMany({
    where: {
      student: { organizationId: scope.organizationId, branchId: scope.branchId, deletedAt: null, ...(opts.sectionId ? { currentSectionId: opts.sectionId } : {}) },
      ...(opts.term ? { term: opts.term } : {}),
    },
    include: { student: { include: { currentSection: { include: { grade: true } } } }, academicYear: true },
    orderBy: [{ generatedAt: "desc" }],
    take: 200,
  });
}

export async function getReportCard(reportCardId: string, scope: ReportScope) {
  return db.reportCard.findFirst({
    where: { id: reportCardId, student: { organizationId: scope.organizationId, branchId: scope.branchId } },
    include: {
      student: { include: { currentSection: { include: { grade: true } }, branch: true } },
      academicYear: true,
      gradingScale: { include: { bands: { orderBy: { minPercent: "desc" } } } },
      lines: { orderBy: { sequence: "asc" } },
    },
  });
}

export interface GenerateOutcome {
  reportCardId: string;
  subjects: number;
  overallPercent: number | null;
  /** Subjects whose teacher comment couldn't be kept, because the subject has no marks any more. */
  droppedComments: string[];
}

/**
 * Gathers a student's marks for a term and writes a SNAPSHOT.
 *
 * Every figure is copied onto the report's lines — and so is the weighting
 * that produced them. A gradebook corrected next month, or a scale edited
 * next year, must not silently change a report a family was handed last
 * term. Regenerating is an explicit act that replaces a draft's figures, and
 * it is refused once the report is published.
 *
 * Teachers' comments are NOT figures: regenerating a draft keeps each
 * subject's comment, so fixing one mark doesn't cost a class teacher an
 * evening of rewriting. A comment whose subject has dropped off the report
 * is named in the outcome rather than lost quietly.
 */
export async function generateReportCard(
  input: { studentId: string; academicYearId: string; term: string; remarks?: string },
  scope: ReportScope,
  actor: Actor,
): Promise<GenerateOutcome> {
  const student = await db.student.findFirst({
    where: { id: input.studentId, organizationId: scope.organizationId, branchId: scope.branchId, deletedAt: null },
    include: { currentSection: true },
  });
  if (!student) throw new SisError("Student not found");
  if (!student.currentSectionId) throw new SisError("This student isn't in a section, so there is nothing to report on");

  const existing = await db.reportCard.findFirst({
    where: { studentId: input.studentId, academicYearId: input.academicYearId, term: input.term },
    include: { lines: { select: { subjectId: true, subjectName: true, comment: true } } },
  });
  if (existing?.status === "PUBLISHED") throw new SisError("This report has been published — it can't be regenerated");

  const scale = await ensureDefaultScale(scope, actor);
  const bands: Band[] = scale.bands.map((b) => ({ label: b.label, minPercent: b.minPercent, description: b.description }));
  const weights = weightsOf(scale);

  // Exam marks: graded attempts on exams for the student's section.
  const attempts = await db.examAttempt.findMany({
    where: { studentId: input.studentId, status: "GRADED", exam: { sectionId: student.currentSectionId } },
    include: { exam: { include: { subject: true } } },
  });

  // Assignment marks: graded submissions on published assignments.
  const submissions = await db.submission.findMany({
    where: { studentId: input.studentId, status: "GRADED", assignment: { sectionId: student.currentSectionId } },
    include: { assignment: { include: { course: { include: { subject: true } } } } },
  });

  type Acc = { subjectId: string | null; subjectName: string; examMarks: number | null; examMax: number | null; assignmentMarks: number | null; assignmentMax: number | null };
  const bySubject = new Map<string, Acc>();
  const keyOf = (id: string | null, name: string) => id ?? `name:${name}`;

  for (const a of attempts) {
    const key = keyOf(a.exam.subjectId, a.exam.subject.name);
    const acc = bySubject.get(key) ?? { subjectId: a.exam.subjectId, subjectName: a.exam.subject.name, examMarks: null, examMax: null, assignmentMarks: null, assignmentMax: null };
    acc.examMarks = (acc.examMarks ?? 0) + (a.marksAwarded ?? 0);
    acc.examMax = (acc.examMax ?? 0) + a.exam.maxMarks;
    bySubject.set(key, acc);
  }
  for (const s of submissions) {
    const subject = s.assignment.course?.subject ?? null;
    const name = subject?.name ?? "Coursework";
    const key = keyOf(subject?.id ?? null, name);
    const acc = bySubject.get(key) ?? { subjectId: subject?.id ?? null, subjectName: name, examMarks: null, examMax: null, assignmentMarks: null, assignmentMax: null };
    acc.assignmentMarks = (acc.assignmentMarks ?? 0) + (s.marksAwarded ?? 0);
    acc.assignmentMax = (acc.assignmentMax ?? 0) + s.assignment.maxMarks;
    bySubject.set(key, acc);
  }

  const accs = [...bySubject.values()].sort((a, b) => a.subjectName.localeCompare(b.subjectName));
  if (accs.length === 0) throw new SisError("There are no graded marks for this student yet");

  const overall = overallResult(accs, weights);

  const previousComments = new Map<string, { subjectName: string; comment: string }>();
  for (const l of existing?.lines ?? []) {
    if (l.comment) previousComments.set(keyOf(l.subjectId, l.subjectName), { subjectName: l.subjectName, comment: l.comment });
  }
  const liveKeys = new Set(accs.map((a) => keyOf(a.subjectId, a.subjectName)));
  const droppedComments = [...previousComments.entries()].filter(([k]) => !liveKeys.has(k)).map(([, v]) => v.subjectName);

  // Attendance for the whole year so far — a report card that says nothing
  // about attendance is missing the thing parents ask about most.
  const records = await db.attendanceRecord.findMany({
    where: { studentId: input.studentId, session: { section: { academicYearId: input.academicYearId } } },
    select: { status: true },
  });
  const attendance = summarize(records.map((r) => r.status));
  const attendancePercent = attendance.attendedRate === null ? null : Math.round(attendance.attendedRate * 100);
  const figures = {
    gradingScaleId: scale.id,
    overallPercent: overall,
    overallBand: bandFor(overall, bands)?.label ?? null,
    attendancePercent,
    examWeight: weights?.exam ?? null,
    courseworkWeight: weights?.coursework ?? null,
    generatedByUserId: actor.userId,
  };

  const card = await db.$transaction(async (tx) => {
    const saved = await tx.reportCard.upsert({
      where: { studentId_academicYearId_term: { studentId: input.studentId, academicYearId: input.academicYearId, term: input.term } },
      create: { studentId: input.studentId, academicYearId: input.academicYearId, term: input.term, remarks: input.remarks ?? null, ...figures },
      // Blank remarks on a regeneration means "not changing them", not "erase
      // what the class teacher wrote".
      update: { ...figures, ...(input.remarks !== undefined ? { remarks: input.remarks } : {}), generatedAt: new Date() },
    });

    await tx.reportCardLine.deleteMany({ where: { reportCardId: saved.id } });
    await tx.reportCardLine.createMany({
      data: accs.map((a, i) => {
        const result = subjectResult(a, weights);
        return {
          reportCardId: saved.id,
          subjectId: a.subjectId,
          subjectName: a.subjectName,
          examMarks: a.examMarks,
          examMax: a.examMax,
          assignmentMarks: a.assignmentMarks,
          assignmentMax: a.assignmentMax,
          percent: result.percent,
          band: bandFor(result.percent, bands)?.label ?? null,
          basisNote: result.note,
          comment: previousComments.get(keyOf(a.subjectId, a.subjectName))?.comment ?? null,
          sequence: i + 1,
        };
      }),
    });
    return saved;
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "report_card.generated",
    resourceType: "student",
    resourceId: input.studentId,
    after: { reportCardId: card.id, term: input.term, subjects: accs.length, overallPercent: overall, weights, droppedComments },
  });

  return { reportCardId: card.id, subjects: accs.length, overallPercent: overall, droppedComments };
}

/**
 * Subject teachers' comments and the overall remarks, on a DRAFT.
 *
 * The draft check is repeated inside the transaction as a conditional
 * update, so a principal publishing at the same moment wins cleanly: the
 * family never receives a report whose comments changed after it was sent.
 */
export async function saveReportComments(
  reportCardId: string,
  input: { comments: { lineId: string; comment: string }[]; remarks: string | undefined },
  scope: ReportScope,
  actor: Actor,
  mayReportOn: (sectionId: string | null) => boolean,
): Promise<{ changed: number }> {
  const card = await db.reportCard.findFirst({
    where: { id: reportCardId, student: { organizationId: scope.organizationId, branchId: scope.branchId } },
    include: { student: { select: { id: true, currentSectionId: true } }, lines: { select: { id: true, comment: true } } },
  });
  if (!card) throw new SisError("Report card not found");
  if (!mayReportOn(card.student.currentSectionId)) throw new SisError("This student isn't in one of your sections");
  if (card.status === "PUBLISHED") throw new SisError("This report has been published — its comments are part of what the family received");

  const current = new Map(card.lines.map((l) => [l.id, l.comment]));
  // Ids from the form are only honoured if they belong to THIS report.
  const changes = input.comments
    .filter((c) => current.has(c.lineId))
    .map((c) => ({ lineId: c.lineId, comment: c.comment.trim().slice(0, 500) || null }))
    .filter((c) => (current.get(c.lineId) ?? null) !== c.comment);
  const remarks = input.remarks === undefined ? undefined : input.remarks.trim().slice(0, 1000) || null;
  const remarksChanged = remarks !== undefined && remarks !== card.remarks;
  if (changes.length === 0 && !remarksChanged) return { changed: 0 };

  await db.$transaction(async (tx) => {
    const stillDraft = await tx.reportCard.updateMany({
      where: { id: reportCardId, status: "DRAFT" },
      data: { remarks: remarksChanged ? remarks : card.remarks },
    });
    if (stillDraft.count === 0) throw new SisError("This report was published while you were editing — its comments can't change now");
    for (const c of changes) {
      await tx.reportCardLine.updateMany({ where: { id: c.lineId, reportCardId }, data: { comment: c.comment } });
    }
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "report_card.comments_saved",
    resourceType: "student",
    resourceId: card.student.id,
    after: { reportCardId, subjectComments: changes.length, remarksChanged },
  });
  return { changed: changes.length + (remarksChanged ? 1 : 0) };
}

export async function publishReportCard(reportCardId: string, scope: ReportScope, actor: Actor) {
  const card = await db.reportCard.findFirst({
    where: { id: reportCardId, student: { organizationId: scope.organizationId, branchId: scope.branchId } },
    include: { student: true, _count: { select: { lines: true } } },
  });
  if (!card) throw new SisError("Report card not found");
  if (card.status === "PUBLISHED") throw new SisError("This report is already published");
  if (card._count.lines === 0) throw new SisError("This report has no subjects on it");

  const published = await db.reportCard.updateMany({ where: { id: reportCardId, status: "DRAFT" }, data: { status: "PUBLISHED", publishedAt: new Date() } });
  if (published.count === 0) throw new SisError("This report is already published");
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "report_card.published",
    resourceType: "student",
    resourceId: card.studentId,
    after: { reportCardId, term: card.term },
  });
}

/** Published reports only — what a parent sees in the portal. */
export async function listPublishedForStudent(studentId: string, organizationId: string) {
  return db.reportCard.findMany({
    where: { studentId, status: "PUBLISHED", student: { organizationId } },
    include: { lines: { orderBy: { sequence: "asc" } }, academicYear: true },
    orderBy: { publishedAt: "desc" },
  });
}
