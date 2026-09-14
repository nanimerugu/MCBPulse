/**
 * Grading scales (blueprint 11.14: "grading engines are curriculum-specific").
 *
 * Phase 5 answered that warning by showing percentages and no letters at
 * all, which was honest but left every school doing the conversion by hand.
 * The real answer is that the scale is DATA: a CBSE school, an IB school and
 * a state-board school disagree about what 72% is called, and none of them
 * are wrong. So the bands are configured per organization and this module
 * only knows how to apply them.
 */

export interface Band {
  label: string;
  minPercent: number;
  description?: string | null;
}

/**
 * The band a percentage falls into. Bands are sorted highest-first, and the
 * first whose threshold is met wins — so overlapping bands resolve to the
 * more generous one rather than failing.
 */
export function bandFor(percent: number | null, bands: readonly Band[]): Band | null {
  if (percent === null || bands.length === 0) return null;
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  return sorted.find((b) => percent >= b.minPercent) ?? null;
}

export type BandProblem =
  | { kind: "no_bands" }
  | { kind: "duplicate_threshold"; minPercent: number }
  | { kind: "duplicate_label"; label: string }
  | { kind: "out_of_range"; minPercent: number }
  | { kind: "no_floor" };

/**
 * A scale must cover every mark from 0 up. A scale whose lowest band starts
 * at 35 silently produces "no grade" for a child who scored 30, which is the
 * worst possible way to tell a family that.
 */
export function checkScale(bands: readonly Band[]): BandProblem | null {
  if (bands.length === 0) return { kind: "no_bands" };

  const thresholds = new Set<number>();
  const labels = new Set<string>();
  for (const b of bands) {
    if (!Number.isInteger(b.minPercent) || b.minPercent < 0 || b.minPercent > 100) return { kind: "out_of_range", minPercent: b.minPercent };
    if (thresholds.has(b.minPercent)) return { kind: "duplicate_threshold", minPercent: b.minPercent };
    if (labels.has(b.label.toLowerCase())) return { kind: "duplicate_label", label: b.label };
    thresholds.add(b.minPercent);
    labels.add(b.label.toLowerCase());
  }
  if (!thresholds.has(0)) return { kind: "no_floor" };
  return null;
}

export function describeBandProblem(problem: BandProblem): string {
  switch (problem.kind) {
    case "no_bands":
      return "A scale needs at least one band";
    case "duplicate_threshold":
      return `Two bands both start at ${problem.minPercent}%`;
    case "duplicate_label":
      return `Two bands are both called "${problem.label}"`;
    case "out_of_range":
      return `${problem.minPercent} isn't a percentage between 0 and 100`;
    case "no_floor":
      return "The lowest band must start at 0%, or a low mark gets no grade at all";
  }
}

export interface SubjectMarks {
  subjectName: string;
  examMarks: number | null;
  examMax: number | null;
  assignmentMarks: number | null;
  assignmentMax: number | null;
}

/**
 * A subject's percentage from whatever evidence exists.
 *
 * Exams and assignments are summed together rather than weighted, and that
 * is a DECISION, not an oversight: a weighting ("exams are 70%") is school
 * policy, and inventing one would put a number on a report card that no
 * teacher chose. Summing both totals is the one combination that needs no
 * policy. A school wanting weights needs them configured, which is named in
 * the README.
 */
export function subjectPercent(marks: SubjectMarks): number | null {
  const awarded = (marks.examMarks ?? 0) + (marks.assignmentMarks ?? 0);
  const possible = (marks.examMax ?? 0) + (marks.assignmentMax ?? 0);
  if (possible <= 0) return null;
  return Math.round((awarded / possible) * 100);
}

/** Overall percentage across subjects, weighted by marks available. */
export function overallPercent(lines: readonly SubjectMarks[]): number | null {
  let awarded = 0;
  let possible = 0;
  for (const l of lines) {
    awarded += (l.examMarks ?? 0) + (l.assignmentMarks ?? 0);
    possible += (l.examMax ?? 0) + (l.assignmentMax ?? 0);
  }
  if (possible <= 0) return null;
  return Math.round((awarded / possible) * 100);
}

export const DEFAULT_BANDS: Band[] = [
  { label: "A1", minPercent: 91, description: "Outstanding" },
  { label: "A2", minPercent: 81, description: "Excellent" },
  { label: "B1", minPercent: 71, description: "Very good" },
  { label: "B2", minPercent: 61, description: "Good" },
  { label: "C1", minPercent: 51, description: "Fair" },
  { label: "C2", minPercent: 41, description: "Satisfactory" },
  { label: "D", minPercent: 33, description: "Needs improvement" },
  { label: "E", minPercent: 0, description: "Needs much improvement" },
];

export const TERMS = ["Term 1", "Term 2", "Term 3", "Annual"] as const;
export type Term = (typeof TERMS)[number];
