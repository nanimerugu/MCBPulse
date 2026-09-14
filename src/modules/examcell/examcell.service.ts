import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { QuestionDifficulty, QuestionType } from "@/generated/prisma/enums";
import { autoGrade, canTransitionAttempt, summarizeAttempt } from "@/modules/examcell/grading";
import { generatePaper, isObjective, seededShuffle, type BlueprintLine } from "@/modules/examcell/paper";
import { SisError, type Actor } from "@/modules/sis/students.service";

export interface ExamScope {
  organizationId: string;
  branchId: string;
}

// --- Question banks ----------------------------------------------------------

export async function listBanks(scope: ExamScope) {
  return db.questionBank.findMany({
    where: { subject: { organizationId: scope.organizationId } },
    include: { subject: true, _count: { select: { questions: { where: { deletedAt: null } } } } },
    orderBy: [{ subject: { name: "asc" } }, { name: "asc" }],
  });
}

export async function getBank(bankId: string, scope: ExamScope) {
  return db.questionBank.findFirst({
    where: { id: bankId, subject: { organizationId: scope.organizationId } },
    include: {
      subject: true,
      questions: {
        where: { deletedAt: null },
        include: { options: { orderBy: { sequence: "asc" } }, _count: { select: { inPapers: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function createBank(input: { subjectId: string; name: string }, scope: ExamScope, actor: Actor) {
  const subject = await db.subject.findFirst({ where: { id: input.subjectId, organizationId: scope.organizationId, deletedAt: null } });
  if (!subject) throw new SisError("Subject not found");

  const bank = await db.questionBank.create({ data: { subjectId: input.subjectId, name: input.name } });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "question_bank.created",
    resourceType: "question_bank",
    resourceId: bank.id,
    after: { name: input.name, subject: subject.name },
  });
  return bank;
}

export interface QuestionInput {
  type: QuestionType;
  text: string;
  marks: number;
  difficulty: QuestionDifficulty;
  /** MCQ / TRUE_FALSE: the choices, with exactly one marked correct. */
  options?: { text: string; isCorrect: boolean }[];
  /** SHORT_ANSWER / ESSAY: the answer key, for the marker's eyes. */
  correctAnswer?: string;
  explanation?: string;
}

export async function addQuestion(bankId: string, input: QuestionInput, scope: ExamScope, actor: Actor) {
  const bank = await db.questionBank.findFirst({ where: { id: bankId, subject: { organizationId: scope.organizationId } } });
  if (!bank) throw new SisError("Question bank not found");
  if (!Number.isInteger(input.marks) || input.marks < 1) throw new SisError("A question must be worth at least one mark");

  if (isObjective(input.type)) {
    const options = input.options ?? [];
    if (options.length < 2) throw new SisError("An objective question needs at least two options");
    const correct = options.filter((o) => o.isCorrect).length;
    // Exactly one, not "at least one": auto-grading compares against a
    // single correct option, so two would make the marking arbitrary.
    if (correct !== 1) throw new SisError("Mark exactly one option as correct");
    if (options.some((o) => o.text.trim().length === 0)) throw new SisError("Every option needs text");
  }

  const question = await db.question.create({
    data: {
      questionBankId: bankId,
      type: input.type,
      text: input.text,
      marks: input.marks,
      difficulty: input.difficulty,
      correctAnswer: isObjective(input.type) ? null : (input.correctAnswer ?? null),
      explanation: input.explanation ?? null,
      options: isObjective(input.type)
        ? { create: (input.options ?? []).map((o, i) => ({ text: o.text, isCorrect: o.isCorrect, sequence: i + 1 })) }
        : undefined,
    },
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "question.created",
    resourceType: "question_bank",
    resourceId: bankId,
    after: { questionId: question.id, type: input.type, marks: input.marks, difficulty: input.difficulty },
  });
  return question;
}

/**
 * Soft-delete. A question that has appeared on a paper is never removed:
 * the paper copied its marks but still references the row, and an exam
 * somebody sat must stay reconstructable.
 */
export async function retireQuestion(questionId: string, scope: ExamScope, actor: Actor) {
  const question = await db.question.findFirst({
    where: { id: questionId, questionBank: { subject: { organizationId: scope.organizationId } }, deletedAt: null },
  });
  if (!question) throw new SisError("Question not found");

  await db.question.update({ where: { id: questionId }, data: { deletedAt: new Date() } });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "question.retired",
    resourceType: "question_bank",
    resourceId: question.questionBankId,
    after: { questionId },
  });
}

// --- Exams -------------------------------------------------------------------

export async function listExams(scope: ExamScope) {
  return db.exam.findMany({
    where: { section: { grade: { branchId: scope.branchId } } },
    include: {
      subject: true,
      section: { include: { grade: true } },
      papers: { include: { _count: { select: { questions: true } } }, orderBy: { version: "desc" } },
      _count: { select: { attempts: true } },
    },
    orderBy: { scheduledAt: "desc" },
    take: 50,
  });
}

export async function getExam(examId: string, scope: ExamScope) {
  return db.exam.findFirst({
    where: { id: examId, section: { grade: { branchId: scope.branchId } } },
    include: {
      subject: true,
      section: { include: { grade: true } },
      papers: {
        orderBy: { version: "desc" },
        include: { questions: { include: { question: { include: { options: { orderBy: { sequence: "asc" } } } } }, orderBy: { sequence: "asc" } } },
      },
      attempts: { include: { student: true, answers: true }, orderBy: { student: { firstName: "asc" } } },
    },
  });
}

export async function createExam(
  input: { sectionId: string; subjectId: string; title: string; scheduledAt: Date; durationMinutes: number; maxMarks: number; instructions?: string },
  scope: ExamScope,
  actor: Actor,
) {
  const section = await db.section.findFirst({ where: { id: input.sectionId, grade: { branchId: scope.branchId } }, include: { grade: true } });
  if (!section) throw new SisError("Section not found");
  const subject = await db.subject.findFirst({ where: { id: input.subjectId, organizationId: scope.organizationId, deletedAt: null } });
  if (!subject) throw new SisError("Subject not found");
  if (input.durationMinutes < 5) throw new SisError("An exam needs at least five minutes");
  if (input.maxMarks < 1) throw new SisError("An exam needs at least one mark");

  const exam = await db.exam.create({
    data: {
      sectionId: input.sectionId,
      subjectId: input.subjectId,
      title: input.title,
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes,
      maxMarks: input.maxMarks,
      instructions: input.instructions ?? null,
    },
  });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "exam.created",
    resourceType: "exam",
    resourceId: exam.id,
    after: { title: input.title, section: `${section.grade.name}/${section.name}`, subject: subject.name, maxMarks: input.maxMarks },
  });
  return exam;
}

export interface GenerateOutcome {
  paperId: string;
  questions: number;
  totalMarks: number;
}

/**
 * Builds a paper from the bank against a blueprint. Refuses rather than
 * approximating: a shortfall or a marks mismatch comes back as an error
 * naming exactly what is missing, because a nearly-right exam paper is worse
 * than none.
 */
export async function generateExamPaper(
  examId: string,
  input: { bankId: string; blueprint: BlueprintLine[]; seed: number },
  scope: ExamScope,
  actor: Actor,
): Promise<GenerateOutcome> {
  const exam = await db.exam.findFirst({ where: { id: examId, section: { grade: { branchId: scope.branchId } } } });
  if (!exam) throw new SisError("Exam not found");
  if (exam.status !== "DRAFT") throw new SisError("A published exam's paper can't be regenerated");

  const bank = await db.questionBank.findFirst({ where: { id: input.bankId, subject: { organizationId: scope.organizationId } } });
  if (!bank) throw new SisError("Question bank not found");

  const pool = await db.question.findMany({
    where: { questionBankId: input.bankId, deletedAt: null },
    select: { id: true, type: true, difficulty: true, marks: true },
  });

  const result = generatePaper(pool, input.blueprint, { requiredMarks: exam.maxMarks, shuffle: seededShuffle(input.seed) });
  if (!result.ok) {
    if (result.reason === "empty_blueprint") throw new SisError("Ask for at least one question");
    if (result.reason === "marks_mismatch") {
      throw new SisError(`That selection comes to ${result.produced} marks, but the exam is out of ${exam.maxMarks}`);
    }
    const { describeShortfall } = await import("@/modules/examcell/paper");
    throw new SisError(`The bank doesn't have enough: ${result.shortfalls.map(describeShortfall).join("; ")}`);
  }

  const paper = await db.$transaction(async (tx) => {
    const last = await tx.examPaper.findFirst({ where: { examId }, orderBy: { version: "desc" }, select: { version: true } });
    const created = await tx.examPaper.create({
      data: { examId, generatedFrom: "generated", version: (last?.version ?? 0) + 1 },
    });
    await tx.examPaperQuestion.createMany({
      data: result.paper.questions.map((q, i) => ({ examPaperId: created.id, questionId: q.id, sequence: i + 1, marks: q.marks })),
    });
    return created;
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "exam_paper.generated",
    resourceType: "exam",
    resourceId: examId,
    // The seed is recorded so the paper can be reproduced from its inputs.
    after: { paperId: paper.id, version: paper.version, questions: result.paper.questions.length, totalMarks: result.paper.totalMarks, seed: input.seed },
  });

  return { paperId: paper.id, questions: result.paper.questions.length, totalMarks: result.paper.totalMarks };
}

/**
 * Publishing creates an attempt row per enrolled student and freezes the
 * paper. Every student gets a row up front so "who hasn't sat it" is a
 * query, not an absence of evidence.
 */
export async function publishExam(examId: string, scope: ExamScope, actor: Actor) {
  const exam = await db.exam.findFirst({
    where: { id: examId, section: { grade: { branchId: scope.branchId } } },
    include: { papers: { include: { _count: { select: { questions: true } } }, orderBy: { version: "desc" }, take: 1 } },
  });
  if (!exam) throw new SisError("Exam not found");
  if (exam.status !== "DRAFT") throw new SisError("This exam is already published");
  const paper = exam.papers[0];
  if (!paper || paper._count.questions === 0) throw new SisError("Build a paper before publishing");

  const students = await db.student.findMany({
    where: { currentSectionId: exam.sectionId, organizationId: scope.organizationId, deletedAt: null, status: "ENROLLED" },
    select: { id: true },
  });
  if (students.length === 0) throw new SisError("There are no enrolled students in this section");

  await db.$transaction(async (tx) => {
    await tx.exam.update({ where: { id: examId }, data: { status: "PUBLISHED" } });
    await tx.examAttempt.createMany({
      data: students.map((s) => ({ examId, studentId: s.id })),
      skipDuplicates: true,
    });
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "exam.published",
    resourceType: "exam",
    resourceId: examId,
    after: { paperVersion: paper.version, attempts: students.length },
  });
  return { attempts: students.length };
}

// --- Marking -----------------------------------------------------------------

/**
 * Records a student's answers and auto-grades the objective ones.
 *
 * Used here by a teacher entering a paper sat on paper — which is how exams
 * actually happen in most schools — and by the student portal when online
 * attempts are switched on. Either way the grading rule is the same one.
 */
export async function submitAttempt(
  attemptId: string,
  answers: { paperQuestionId: string; selectedOptionId?: string; responseText?: string }[],
  scope: ExamScope,
  actor: Actor,
) {
  const attempt = await db.examAttempt.findFirst({
    where: { id: attemptId, exam: { section: { grade: { branchId: scope.branchId } } } },
    include: {
      exam: { include: { papers: { orderBy: { version: "desc" }, take: 1, include: { questions: { include: { question: { include: { options: true } } } } } } } },
      student: true,
    },
  });
  if (!attempt) throw new SisError("Attempt not found");
  if (attempt.status === "GRADED") throw new SisError("This attempt has already been graded");
  if (!canTransitionAttempt(attempt.status, "SUBMITTED") && attempt.status !== "NOT_STARTED") {
    throw new SisError(`An attempt that is ${attempt.status.toLowerCase().replace(/_/g, " ")} can't be submitted`);
  }

  const paper = attempt.exam.papers[0];
  if (!paper) throw new SisError("This exam has no paper");
  const byId = new Map(paper.questions.map((pq) => [pq.id, pq]));

  const rows = answers.map((a) => {
    const pq = byId.get(a.paperQuestionId);
    if (!pq) throw new SisError("An answer refers to a question that isn't on this paper");
    const correct = pq.question.options.find((o) => o.isCorrect) ?? null;
    const graded = autoGrade({
      questionType: pq.question.type,
      marks: pq.marks,
      selectedOptionId: a.selectedOptionId ?? null,
      correctOptionId: correct?.id ?? null,
      responseText: a.responseText ?? null,
    });
    return {
      examAttemptId: attemptId,
      examPaperQuestionId: pq.id,
      questionId: pq.questionId,
      selectedOptionId: a.selectedOptionId ?? null,
      responseText: a.responseText ?? null,
      marksAwarded: graded.marksAwarded,
      autoGraded: graded.autoGraded,
    };
  });

  const totals = summarizeAttempt(
    rows.map((r) => ({ marksAwarded: r.marksAwarded, autoGraded: r.autoGraded, marks: byId.get(r.examPaperQuestionId)!.marks })),
  );

  await db.$transaction(async (tx) => {
    await tx.examAnswer.deleteMany({ where: { examAttemptId: attemptId } });
    if (rows.length > 0) await tx.examAnswer.createMany({ data: rows });
    await tx.examAttempt.update({
      where: { id: attemptId },
      data: {
        status: totals.awaitingTeacher === 0 ? "GRADED" : "SUBMITTED",
        submittedAt: attempt.submittedAt ?? new Date(),
        startedAt: attempt.startedAt ?? new Date(),
        marksAwarded: totals.awaitingTeacher === 0 ? totals.awarded : null,
        gradedAt: totals.awaitingTeacher === 0 ? new Date() : null,
      },
    });
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "exam_attempt.submitted",
    resourceType: "exam",
    resourceId: attempt.examId,
    after: {
      attemptId,
      student: `${attempt.student.firstName} ${attempt.student.lastName}`,
      autoGraded: totals.autoGradedCount,
      awaitingTeacher: totals.awaitingTeacher,
      awarded: totals.awarded,
    },
  });

  return totals;
}

/** A teacher marking the subjective answers the machine left alone. */
export async function gradeAnswers(
  attemptId: string,
  marks: { answerId: string; marksAwarded: number; feedback?: string }[],
  scope: ExamScope,
  actor: Actor,
) {
  const attempt = await db.examAttempt.findFirst({
    where: { id: attemptId, exam: { section: { grade: { branchId: scope.branchId } } } },
    include: { answers: { include: { examPaperQuestion: true } }, student: true },
  });
  if (!attempt) throw new SisError("Attempt not found");
  if (attempt.status === "NOT_STARTED") throw new SisError("This student hasn't sat the exam");

  const byId = new Map(attempt.answers.map((a) => [a.id, a]));
  for (const m of marks) {
    const answer = byId.get(m.answerId);
    if (!answer) throw new SisError("A mark refers to an answer that isn't on this attempt");
    if (m.marksAwarded < 0 || m.marksAwarded > answer.examPaperQuestion.marks) {
      throw new SisError(`A mark is outside 0–${answer.examPaperQuestion.marks}`);
    }
  }

  const staff = await db.staff.findFirst({ where: { userId: actor.userId, organizationId: scope.organizationId, deletedAt: null } });

  await db.$transaction(async (tx) => {
    for (const m of marks) {
      await tx.examAnswer.update({
        where: { id: m.answerId },
        data: { marksAwarded: m.marksAwarded, feedback: m.feedback ?? null, autoGraded: false },
      });
    }
    const after = await tx.examAnswer.findMany({ where: { examAttemptId: attemptId }, include: { examPaperQuestion: true } });
    const totals = summarizeAttempt(after.map((a) => ({ marksAwarded: a.marksAwarded, autoGraded: a.autoGraded, marks: a.examPaperQuestion.marks })));
    await tx.examAttempt.update({
      where: { id: attemptId },
      data: {
        status: totals.awaitingTeacher === 0 ? "GRADED" : "SUBMITTED",
        marksAwarded: totals.awaitingTeacher === 0 ? totals.awarded : null,
        gradedAt: totals.awaitingTeacher === 0 ? new Date() : null,
        gradedByStaffId: staff?.id ?? null,
      },
    });
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "exam_attempt.graded",
    resourceType: "exam",
    resourceId: attempt.examId,
    after: { attemptId, student: `${attempt.student.firstName} ${attempt.student.lastName}`, marked: marks.length },
  });
}

export async function getAttempt(attemptId: string, scope: ExamScope) {
  return db.examAttempt.findFirst({
    where: { id: attemptId, exam: { section: { grade: { branchId: scope.branchId } } } },
    include: {
      student: true,
      exam: { include: { subject: true, section: { include: { grade: true } } } },
      answers: {
        include: { examPaperQuestion: { include: { question: { include: { options: { orderBy: { sequence: "asc" } } } } } } },
        orderBy: { examPaperQuestion: { sequence: "asc" } },
      },
    },
  });
}
