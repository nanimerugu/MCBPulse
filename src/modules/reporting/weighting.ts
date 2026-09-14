/**
 * How exam and coursework marks combine into a subject percentage.
 *
 * Two modes, and the choice is the school's, stored on the grading scale:
 *
 *   - ADDED TOGETHER (no weights): 40/50 in exams plus 8/10 in coursework is
 *     48/60 = 80%. Needs no policy, and a component with more marks available
 *     counts for more — which is sometimes exactly wrong.
 *   - WEIGHTED ("exams 80, coursework 20"): each component becomes a
 *     percentage first, then they are blended. 80% and 50% at 80/20 is 74%,
 *     however many marks each happened to be out of.
 *
 * The hard case is missing evidence. At 80/20, a subject with an exam but no
 * marked coursework has nothing to put in the 20%. Counting it as zero would
 * cap the child at 80% for work nobody set; quietly using the exam alone
 * changes the basis without saying so. So the exam percentage is used AND
 * the report line says so, in words, on the printed report.
 */

export interface Weights {
  exam: number;
  coursework: number;
}

export interface SubjectEvidence {
  examMarks: number | null;
  examMax: number | null;
  assignmentMarks: number | null;
  assignmentMax: number | null;
}

export type Basis = "both" | "exam_only" | "coursework_only" | "none";

export interface SubjectResult {
  percent: number | null;
  basis: Basis;
  /** Set only when the weighting couldn't apply as written. */
  note: string | null;
}

export type WeightCheck = { ok: true; weights: Weights | null } | { ok: false; message: string };

/** Both blank = add marks together. Otherwise two whole numbers summing to 100. */
export function checkWeights(examRaw: string | undefined, courseworkRaw: string | undefined): WeightCheck {
  const e = (examRaw ?? "").trim();
  const c = (courseworkRaw ?? "").trim();
  if (e === "" && c === "") return { ok: true, weights: null };
  if (e === "" || c === "") return { ok: false, message: "Give both weights, or leave both blank to add marks together" };
  const exam = Number(e);
  const coursework = Number(c);
  if (![exam, coursework].every((n) => Number.isInteger(n) && n >= 0 && n <= 100)) {
    return { ok: false, message: "Weights are whole percentages from 0 to 100" };
  }
  if (exam + coursework !== 100) return { ok: false, message: `Weights must add up to 100 — these add up to ${exam + coursework}` };
  return { ok: true, weights: { exam, coursework } };
}

export function weightsOf(row: { examWeight: number | null; courseworkWeight: number | null }): Weights | null {
  return row.examWeight !== null && row.courseworkWeight !== null ? { exam: row.examWeight, coursework: row.courseworkWeight } : null;
}

export function describeWeights(weights: Weights | null): string {
  return weights ? `Exams ${weights.exam}% · Coursework ${weights.coursework}%` : "Exam and coursework marks added together";
}

export function subjectResult(e: SubjectEvidence, weights: Weights | null): SubjectResult {
  const hasExam = (e.examMax ?? 0) > 0;
  const hasCoursework = (e.assignmentMax ?? 0) > 0;
  const basis: Basis = hasExam && hasCoursework ? "both" : hasExam ? "exam_only" : hasCoursework ? "coursework_only" : "none";
  if (basis === "none") return { percent: null, basis, note: null };

  if (!weights) {
    const awarded = (e.examMarks ?? 0) + (e.assignmentMarks ?? 0);
    const possible = (e.examMax ?? 0) + (e.assignmentMax ?? 0);
    return { percent: Math.round((awarded / possible) * 100), basis, note: null };
  }

  const examPct = hasExam ? ((e.examMarks ?? 0) / (e.examMax as number)) * 100 : 0;
  const courseworkPct = hasCoursework ? ((e.assignmentMarks ?? 0) / (e.assignmentMax as number)) * 100 : 0;

  if (basis === "both") {
    return { percent: Math.round((examPct * weights.exam + courseworkPct * weights.coursework) / 100), basis, note: null };
  }

  const present = basis === "exam_only" ? { name: "exams", pct: examPct, weight: weights.exam } : { name: "coursework", pct: courseworkPct, weight: weights.coursework };
  const missing = basis === "exam_only" ? "coursework" : "exams";

  // The only evidence is a component this scale gives no weight at all. A
  // percentage from it would contradict the school's own policy.
  if (present.weight === 0) {
    return { percent: null, basis, note: `Only ${present.name} were marked, and this scale gives ${present.name} no weight — no grade` };
  }
  return {
    percent: Math.round(present.pct),
    basis,
    note: `${present.name === "exams" ? "Exams" : "Coursework"} only — no ${missing} marked, so the ${weights.exam}/${weights.coursework} weighting couldn't apply`,
  };
}

/**
 * The overall figure.
 *
 * Added together: every mark counts once, so a subject out of 100 outweighs
 * one out of 10 — consistent with how each subject was computed. Weighted:
 * each subject is a percentage already, so they count equally; weighting
 * subjects by raw marks would smuggle back exactly the distortion the
 * school chose weights to remove.
 */
export function overallResult(evidence: readonly SubjectEvidence[], weights: Weights | null): number | null {
  if (!weights) {
    let awarded = 0;
    let possible = 0;
    for (const e of evidence) {
      awarded += (e.examMarks ?? 0) + (e.assignmentMarks ?? 0);
      possible += (e.examMax ?? 0) + (e.assignmentMax ?? 0);
    }
    return possible > 0 ? Math.round((awarded / possible) * 100) : null;
  }
  const percents = evidence.map((e) => subjectResult(e, weights).percent).filter((p): p is number => p !== null);
  if (percents.length === 0) return null;
  return Math.round(percents.reduce((a, b) => a + b, 0) / percents.length);
}
