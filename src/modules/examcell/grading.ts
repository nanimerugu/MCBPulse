import type { ExamAttemptStatus, QuestionType } from "@/generated/prisma/enums";
import { isObjective } from "@/modules/examcell/paper";

/**
 * Exam grading (blueprint 11.15: "Auto-grade objective items; teacher /
 * AI-assisted grade subjective items").
 *
 * The split is the whole design. A machine can mark an MCQ because there is
 * a right answer recorded against an option. It cannot mark an essay, and
 * pretending otherwise produces marks nobody can defend at a parents'
 * evening. So objective answers are graded on submission, subjective ones
 * are left explicitly ungraded, and the attempt is not GRADED until a person
 * has dealt with the remainder.
 */

export interface AnswerToGrade {
  questionType: QuestionType;
  marks: number;
  selectedOptionId: string | null;
  correctOptionId: string | null;
  responseText: string | null;
}

export interface GradedAnswer {
  marksAwarded: number | null;
  autoGraded: boolean;
}

export function autoGrade(answer: AnswerToGrade): GradedAnswer {
  if (!isObjective(answer.questionType)) return { marksAwarded: null, autoGraded: false };
  // Unanswered is zero, not ungraded: the student saw it and left it.
  if (!answer.selectedOptionId) return { marksAwarded: 0, autoGraded: true };
  // A question with no correct option recorded is a setup error. Refusing to
  // guess leaves it for a human rather than marking everyone wrong.
  if (!answer.correctOptionId) return { marksAwarded: null, autoGraded: false };
  return { marksAwarded: answer.selectedOptionId === answer.correctOptionId ? answer.marks : 0, autoGraded: true };
}

export interface AttemptTotals {
  awarded: number;
  possible: number;
  autoGradedCount: number;
  awaitingTeacher: number;
  percentage: number | null;
}

/**
 * Totals for an attempt. `percentage` is null while anything is still
 * awaiting a teacher — reporting "40%" on a half-marked paper is a number
 * that will change, shown as though it won't.
 */
export function summarizeAttempt(answers: readonly { marksAwarded: number | null; autoGraded: boolean; marks: number }[]): AttemptTotals {
  let awarded = 0;
  let possible = 0;
  let autoGradedCount = 0;
  let awaitingTeacher = 0;

  for (const a of answers) {
    possible += a.marks;
    if (a.marksAwarded === null) {
      awaitingTeacher += 1;
      continue;
    }
    awarded += a.marksAwarded;
    if (a.autoGraded) autoGradedCount += 1;
  }

  return {
    awarded,
    possible,
    autoGradedCount,
    awaitingTeacher,
    percentage: awaitingTeacher > 0 || possible === 0 ? null : awarded / possible,
  };
}

export type MarkProblem = "not_a_number" | "negative" | "exceeds_max";

export function validateExamMark(marks: number | null, max: number): MarkProblem | null {
  if (marks === null) return null;
  if (!Number.isFinite(marks)) return "not_a_number";
  if (marks < 0) return "negative";
  if (marks > max) return "exceeds_max";
  return null;
}

export const EXAM_MARK_PROBLEMS: Record<MarkProblem, string> = {
  not_a_number: "Enter a number",
  negative: "Marks can't be negative",
  exceeds_max: "More than this question is worth",
};

/** Attempt lifecycle: NOT_STARTED → IN_PROGRESS → SUBMITTED → GRADED. */
const ATTEMPT_NEXT: Record<ExamAttemptStatus, ExamAttemptStatus[]> = {
  NOT_STARTED: ["IN_PROGRESS"],
  IN_PROGRESS: ["SUBMITTED"],
  SUBMITTED: ["GRADED"],
  GRADED: [],
};

export function canTransitionAttempt(from: ExamAttemptStatus, to: ExamAttemptStatus): boolean {
  return ATTEMPT_NEXT[from].includes(to);
}

export const ATTEMPT_STATUS_LABELS: Record<ExamAttemptStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  GRADED: "Graded",
};

/**
 * Is the exam open right now? A window, not a moment: an exam scheduled for
 * 10:00 lasting 60 minutes can be started until 11:00, after which a student
 * arriving late has missed it.
 */
export function examWindow(scheduledAt: Date, durationMinutes: number, now: Date): "upcoming" | "open" | "closed" {
  const start = scheduledAt.getTime();
  const end = start + durationMinutes * 60_000;
  const t = now.getTime();
  if (t < start) return "upcoming";
  return t <= end ? "open" : "closed";
}

/** When an in-progress attempt must be handed in. */
export function attemptDeadline(startedAt: Date, durationMinutes: number, scheduledAt: Date): Date {
  // Whichever comes first: the student's own clock, or the exam's end. A
  // late starter does not get extra time past the end of the exam.
  const personal = startedAt.getTime() + durationMinutes * 60_000;
  const examEnd = scheduledAt.getTime() + durationMinutes * 60_000;
  return new Date(Math.min(personal, examEnd));
}
