import type { SubmissionStatus } from "@/generated/prisma/enums";

/**
 * Grading rules (blueprint 11.14 / 10.3 "grade manually ... publish remarks").
 * Pure: no DB, no dates from outside. The service asks these questions and
 * refuses anything they reject, so a buggy caller can't record a mark of 12
 * out of 10 or mark work graded before it was submitted.
 *
 * Status is derived, never chosen:
 *   nothing recorded                    -> PENDING
 *   submitted on or before the due date -> SUBMITTED
 *   submitted after the due date        -> LATE
 *   marks recorded                      -> GRADED
 * LATE is kept once graded (the lateness is a fact about the submission, so
 * `wasLate` travels separately rather than being erased by the mark).
 */

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  PENDING: "Not submitted",
  SUBMITTED: "Submitted",
  LATE: "Submitted late",
  GRADED: "Graded",
};

export function deriveSubmissionStatus(args: { submittedAt: Date | null; dueAt: Date; marksAwarded: number | null }): SubmissionStatus {
  if (args.marksAwarded !== null) return "GRADED";
  if (!args.submittedAt) return "PENDING";
  return args.submittedAt.getTime() > args.dueAt.getTime() ? "LATE" : "SUBMITTED";
}

export function isLate(submittedAt: Date | null, dueAt: Date): boolean {
  return Boolean(submittedAt && submittedAt.getTime() > dueAt.getTime());
}

export type MarkProblem = "not_a_number" | "negative" | "exceeds_max" | "not_submitted";

/** Returns null when the mark is acceptable, otherwise why it isn't. */
export function validateMark(args: { marks: number | null; maxMarks: number; submittedAt: Date | null }): MarkProblem | null {
  if (args.marks === null) return null; // clearing a mark is always allowed
  if (!Number.isFinite(args.marks)) return "not_a_number";
  if (args.marks < 0) return "negative";
  if (args.marks > args.maxMarks) return "exceeds_max";
  // Marking work nobody handed in is almost always a mistake; recording the
  // submission first makes the timeline honest.
  if (!args.submittedAt) return "not_submitted";
  return null;
}

export const MARK_PROBLEM_MESSAGES: Record<MarkProblem, string> = {
  not_a_number: "Enter a number",
  negative: "A mark can't be negative",
  exceeds_max: "That's more than the assignment is out of",
  not_submitted: "Record the submission before grading it",
};

export interface GradebookCell {
  marksAwarded: number | null;
  maxMarks: number;
  status: SubmissionStatus;
}

export interface GradebookTotals {
  gradedCount: number;
  awardedMarks: number;
  possibleMarks: number;
  /** awarded / possible across GRADED work only, or null when nothing is graded. */
  percentage: number | null;
  pendingCount: number;
  lateCount: number;
}

/**
 * Aggregates one student's row. Only graded work counts toward the
 * percentage — an assignment nobody has marked yet would otherwise drag
 * every average to zero and make the gradebook lie during term.
 */
export function summarizeRow(cells: readonly GradebookCell[]): GradebookTotals {
  let gradedCount = 0;
  let awardedMarks = 0;
  let possibleMarks = 0;
  let pendingCount = 0;
  let lateCount = 0;
  for (const c of cells) {
    if (c.status === "PENDING") pendingCount++;
    if (c.status === "LATE") lateCount++;
    if (c.status === "GRADED" && c.marksAwarded !== null) {
      gradedCount++;
      awardedMarks += c.marksAwarded;
      possibleMarks += c.maxMarks;
    }
  }
  return {
    gradedCount,
    awardedMarks,
    possibleMarks,
    percentage: possibleMarks > 0 ? awardedMarks / possibleMarks : null,
    pendingCount,
    lateCount,
  };
}

export function formatPercentage(p: number | null): string {
  return p === null ? "—" : `${Math.round(p * 100)}%`;
}

/**
 * Deliberately NOT a letter grade. The blueprint (11.14) says to "support
 * curriculum-specific grading engines rather than hard-coding one grading
 * model" — CBSE, IB and Cambridge disagree about what 78% is called. The
 * gradebook shows percentages until a curriculum grading engine exists.
 */
