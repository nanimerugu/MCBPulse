/**
 * Year-end promotion — the pure half.
 *
 * Every March a school moves hundreds of children up a grade, keeps a few
 * back, and says goodbye to its top class. Doing that one Student 360 at a
 * time is a week of clicking; getting it half-done leaves the school with
 * some children in next year and some in last. So the whole year is planned
 * on one screen, checked as a whole, and committed as one transaction.
 *
 * This module proposes the obvious plan and checks a set of decisions. It
 * never commits anything.
 */

export type Decision = "PROMOTE" | "RETAIN" | "GRADUATE" | "UNPLACED";

export const DECISIONS: readonly Decision[] = ["PROMOTE", "RETAIN", "GRADUATE", "UNPLACED"];

export const DECISION_LABELS: Record<Decision, string> = {
  PROMOTE: "Promote",
  RETAIN: "Keep in the same grade",
  GRADUATE: "Graduate",
  UNPLACED: "Leave unplaced for now",
};

export interface PlanStudent {
  studentId: string;
  name: string;
  admissionNumber: string;
  gradeId: string;
  gradeName: string;
  gradeSequence: number;
  sectionName: string;
}

export interface NextYearSection {
  id: string;
  gradeId: string;
  gradeName: string;
  gradeSequence: number;
  name: string;
  capacity: number | null;
}

export interface PlanRow {
  student: PlanStudent;
  decision: Decision;
  targetSectionId: string | null;
  /** Why the suggestion isn't the plain one, in words. */
  note: string | null;
}

function sectionIn(sections: readonly NextYearSection[], gradeSequence: number, preferredName: string): { section: NextYearSection | null; fellBack: boolean } {
  const inGrade = sections.filter((s) => s.gradeSequence === gradeSequence).sort((a, b) => a.name.localeCompare(b.name));
  const same = inGrade.find((s) => s.name.toLowerCase() === preferredName.toLowerCase());
  if (same) return { section: same, fellBack: false };
  return { section: inGrade[0] ?? null, fellBack: inGrade.length > 0 };
}

/**
 * The obvious plan: everyone moves to the next grade, into the section with
 * the same name (5A → 6A) when next year has one; the top grade graduates.
 * Anything that can't be done the obvious way is marked with a reason, not
 * guessed at.
 *
 * "Next grade" follows grade ORDER (the sequence set on the academic
 * structure screen), not grade names, so "Grade 10 → Grade 11" works even
 * though "10" sorts before "9" as text.
 */
export function suggestPlan(students: readonly PlanStudent[], nextYear: readonly NextYearSection[], gradeSequences: readonly number[]): PlanRow[] {
  const ordered = [...new Set(gradeSequences)].sort((a, b) => a - b);
  const top = ordered.at(-1);

  return students.map((student) => {
    if (student.gradeSequence === top) return { student, decision: "GRADUATE", targetSectionId: null, note: null };

    const nextSeq = ordered.find((s) => s > student.gradeSequence);
    if (nextSeq === undefined) return { student, decision: "UNPLACED", targetSectionId: null, note: "There is no higher grade to move to" };

    const { section, fellBack } = sectionIn(nextYear, nextSeq, student.sectionName);
    if (!section) {
      return { student, decision: "UNPLACED", targetSectionId: null, note: "The next grade has no sections next year — add them, or place this student by hand" };
    }
    return {
      student,
      decision: "PROMOTE",
      targetSectionId: section.id,
      note: fellBack ? `No section ${student.sectionName} in ${section.gradeName} next year — suggested ${section.name}` : null,
    };
  });
}

export interface DecisionInput {
  studentId: string;
  decision: Decision;
  targetSectionId: string | null;
}

export type PlanCheck = { ok: true } | { ok: false; problems: string[] };

/**
 * Check a whole year's decisions before anything is written.
 *
 * Every problem is reported at once — a coordinator fixing a 400-row plan
 * should not discover issues one per submit. Covered:
 *   - every enrolled student has exactly one decision, and no stranger does;
 *   - promote means a HIGHER grade next year, retain means the SAME grade;
 *   - graduating is for the top grade (a child leaving from Grade 3 is a
 *     withdrawal or transfer, which the Student 360 records properly);
 *   - no section is filled past its capacity.
 */
export function checkPlan(students: readonly PlanStudent[], decisions: readonly DecisionInput[], nextYear: readonly NextYearSection[], gradeSequences: readonly number[]): PlanCheck {
  const problems: string[] = [];
  const byStudent = new Map(students.map((s) => [s.studentId, s]));
  const sections = new Map(nextYear.map((s) => [s.id, s]));
  const top = Math.max(...gradeSequences);
  const seen = new Set<string>();
  const filled = new Map<string, number>();

  for (const d of decisions) {
    const s = byStudent.get(d.studentId);
    if (!s) {
      problems.push("A decision was sent for a student who isn't enrolled this year — reload the plan");
      continue;
    }
    if (seen.has(d.studentId)) {
      problems.push(`${s.name} has more than one decision`);
      continue;
    }
    seen.add(d.studentId);

    if (d.decision === "PROMOTE" || d.decision === "RETAIN") {
      const target = d.targetSectionId ? sections.get(d.targetSectionId) : undefined;
      if (!target) {
        problems.push(`${s.name}: choose a section in next year`);
        continue;
      }
      if (d.decision === "PROMOTE" && target.gradeSequence <= s.gradeSequence) problems.push(`${s.name}: promotion must be to a higher grade than ${s.gradeName}`);
      if (d.decision === "RETAIN" && target.gradeId !== s.gradeId) problems.push(`${s.name}: keeping a student back means a ${s.gradeName} section next year`);
      filled.set(target.id, (filled.get(target.id) ?? 0) + 1);
    } else if (d.targetSectionId) {
      problems.push(`${s.name}: ${DECISION_LABELS[d.decision].toLowerCase()} doesn't take a section`);
    }
    if (d.decision === "GRADUATE" && s.gradeSequence !== top) {
      problems.push(`${s.name}: only the top grade graduates — record a withdrawal or transfer on the Student 360 instead`);
    }
  }

  for (const s of students) if (!seen.has(s.studentId)) problems.push(`${s.name} has no decision`);

  for (const [sectionId, count] of filled) {
    const sec = sections.get(sectionId)!;
    if (sec.capacity !== null && count > sec.capacity) problems.push(`${sec.gradeName} / ${sec.name} next year would hold ${count} but its capacity is ${sec.capacity}`);
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

export function summarizePlan(decisions: readonly { decision: Decision }[]): Record<Decision, number> {
  const out: Record<Decision, number> = { PROMOTE: 0, RETAIN: 0, GRADUATE: 0, UNPLACED: 0 };
  for (const d of decisions) out[d.decision]++;
  return out;
}

/** A new year must start after the one ending, and not overlap any other. */
export function checkNewYearDates(args: { startISO: string; endISO: string; existing: readonly { name: string; startISO: string; endISO: string }[] }): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.startISO) || !/^\d{4}-\d{2}-\d{2}$/.test(args.endISO)) return "Pick a start and an end date";
  if (args.endISO <= args.startISO) return "The year must end after it starts";
  const clash = args.existing.find((y) => args.startISO <= y.endISO && y.startISO <= args.endISO);
  return clash ? `Those dates overlap ${clash.name}` : null;
}
