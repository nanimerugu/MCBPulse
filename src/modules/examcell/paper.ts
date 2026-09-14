import type { QuestionDifficulty, QuestionType } from "@/generated/prisma/enums";

/**
 * Paper generation (blueprint 11.15: "AI generator supports syllabus
 * restrictions, question types, marks, difficulty, randomization, preview /
 * edit and export").
 *
 * This is the non-AI half, and it is the half that has to be right: a
 * deterministic selection that honours a blueprint of "n easy MCQs, n hard
 * essays" and lands on the exam's total marks. A generator that quietly
 * produces a 47-mark paper for a 50-mark exam wastes a teacher's afternoon.
 *
 * So it either produces a paper that satisfies every constraint, or it
 * explains precisely what the bank is missing. It never returns a nearly
 * right paper.
 */

export interface QuestionSummary {
  id: string;
  type: QuestionType;
  difficulty: QuestionDifficulty;
  marks: number;
}

/** "3 easy MCQs" — one line of a paper specification. */
export interface BlueprintLine {
  type: QuestionType;
  difficulty: QuestionDifficulty;
  count: number;
}

export interface GeneratedPaper {
  questions: QuestionSummary[];
  totalMarks: number;
}

export type Shortfall = { type: QuestionType; difficulty: QuestionDifficulty; wanted: number; available: number };

export type GenerationResult =
  | { ok: true; paper: GeneratedPaper }
  | { ok: false; reason: "shortfall"; shortfalls: Shortfall[] }
  | { ok: false; reason: "marks_mismatch"; produced: number; required: number }
  | { ok: false; reason: "empty_blueprint" };

/**
 * Deterministic given the same `pick` order. Randomisation is injected
 * rather than taken from Math.random so a generated paper can be reproduced
 * from its inputs — which matters when a school is asked how a paper was
 * put together.
 */
export function generatePaper(
  pool: readonly QuestionSummary[],
  blueprint: readonly BlueprintLine[],
  opts: { requiredMarks?: number; shuffle?: <T>(items: T[]) => T[] } = {},
): GenerationResult {
  const lines = blueprint.filter((l) => l.count > 0);
  if (lines.length === 0) return { ok: false, reason: "empty_blueprint" };

  const shuffle = opts.shuffle ?? ((items) => items);
  const chosen: QuestionSummary[] = [];
  const shortfalls: Shortfall[] = [];
  const used = new Set<string>();

  for (const line of lines) {
    const candidates = shuffle(pool.filter((q) => q.type === line.type && q.difficulty === line.difficulty && !used.has(q.id)));
    if (candidates.length < line.count) {
      shortfalls.push({ type: line.type, difficulty: line.difficulty, wanted: line.count, available: candidates.length });
      continue;
    }
    for (const q of candidates.slice(0, line.count)) {
      used.add(q.id);
      chosen.push(q);
    }
  }

  if (shortfalls.length > 0) return { ok: false, reason: "shortfall", shortfalls };

  const totalMarks = chosen.reduce((s, q) => s + q.marks, 0);
  if (opts.requiredMarks !== undefined && totalMarks !== opts.requiredMarks) {
    return { ok: false, reason: "marks_mismatch", produced: totalMarks, required: opts.requiredMarks };
  }

  return { ok: true, paper: { questions: chosen, totalMarks } };
}

export function describeShortfall(s: Shortfall): string {
  return `${s.wanted} ${s.difficulty.toLowerCase()} ${QUESTION_TYPE_LABELS[s.type]} question${s.wanted === 1 ? "" : "s"} — the bank has ${s.available}`;
}

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  MCQ: "multiple choice",
  TRUE_FALSE: "true/false",
  SHORT_ANSWER: "short answer",
  ESSAY: "essay",
};

export const QUESTION_TYPES: QuestionType[] = ["MCQ", "TRUE_FALSE", "SHORT_ANSWER", "ESSAY"];
export const DIFFICULTIES: QuestionDifficulty[] = ["EASY", "MEDIUM", "HARD"];

/** MCQ and TRUE_FALSE have a right answer a machine can check; the others don't. */
export function isObjective(type: QuestionType): boolean {
  return type === "MCQ" || type === "TRUE_FALSE";
}

/**
 * A deterministic shuffle from a seed, so "randomised" is still reproducible.
 * The FACTORY is not generic and the returned function is, so one shuffler
 * can be handed to `generatePaper` without pinning it to a single type.
 */
export function seededShuffle(seed: number): <T>(items: T[]) => T[] {
  let state = seed >>> 0 || 1;
  const next = () => {
    // xorshift32 — small, fast, and good enough for ordering exam questions.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  return <T,>(items: T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
}
