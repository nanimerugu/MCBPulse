import { describe, expect, it } from "vitest";
import { generatePaper, isObjective, seededShuffle, type QuestionSummary } from "@/modules/examcell/paper";

const q = (id: string, type: QuestionSummary["type"], difficulty: QuestionSummary["difficulty"], marks: number): QuestionSummary => ({
  id,
  type,
  difficulty,
  marks,
});

const pool: QuestionSummary[] = [
  q("m1", "MCQ", "EASY", 1),
  q("m2", "MCQ", "EASY", 1),
  q("m3", "MCQ", "EASY", 1),
  q("m4", "MCQ", "HARD", 2),
  q("s1", "SHORT_ANSWER", "MEDIUM", 3),
  q("s2", "SHORT_ANSWER", "MEDIUM", 3),
  q("e1", "ESSAY", "HARD", 10),
];

describe("generatePaper", () => {
  it("picks exactly what the blueprint asks for", () => {
    const r = generatePaper(pool, [
      { type: "MCQ", difficulty: "EASY", count: 2 },
      { type: "ESSAY", difficulty: "HARD", count: 1 },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.paper.questions).toHaveLength(3);
      expect(r.paper.totalMarks).toBe(1 + 1 + 10);
    }
  });

  it("never uses the same question twice across lines", () => {
    const r = generatePaper(pool, [
      { type: "MCQ", difficulty: "EASY", count: 2 },
      { type: "MCQ", difficulty: "EASY", count: 1 },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(new Set(r.paper.questions.map((x) => x.id)).size).toBe(3);
  });

  it("reports a shortfall precisely instead of returning a short paper", () => {
    const r = generatePaper(pool, [{ type: "ESSAY", difficulty: "HARD", count: 3 }]);
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "shortfall") {
      expect(r.shortfalls).toEqual([{ type: "ESSAY", difficulty: "HARD", wanted: 3, available: 1 }]);
    }
  });

  it("reports every shortfall at once, so a teacher fixes the bank in one pass", () => {
    const r = generatePaper(pool, [
      { type: "ESSAY", difficulty: "HARD", count: 3 },
      { type: "MCQ", difficulty: "MEDIUM", count: 2 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "shortfall") expect(r.shortfalls).toHaveLength(2);
  });

  it("counts exhaustion across lines when reporting a shortfall", () => {
    // Three easy MCQs exist; asking for 2 then 2 must fail on the second.
    const r = generatePaper(pool, [
      { type: "MCQ", difficulty: "EASY", count: 2 },
      { type: "MCQ", difficulty: "EASY", count: 2 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "shortfall") expect(r.shortfalls[0]).toMatchObject({ wanted: 2, available: 1 });
  });

  it("refuses a paper that misses the exam's total marks", () => {
    const r = generatePaper(pool, [{ type: "MCQ", difficulty: "EASY", count: 2 }], { requiredMarks: 50 });
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "marks_mismatch") {
      expect(r.produced).toBe(2);
      expect(r.required).toBe(50);
    }
  });

  it("accepts a paper that hits the total exactly", () => {
    const r = generatePaper(pool, [{ type: "ESSAY", difficulty: "HARD", count: 1 }], { requiredMarks: 10 });
    expect(r.ok).toBe(true);
  });

  it("rejects an empty blueprint rather than producing an empty paper", () => {
    expect(generatePaper(pool, []).ok).toBe(false);
    expect(generatePaper(pool, [{ type: "MCQ", difficulty: "EASY", count: 0 }]).ok).toBe(false);
  });
});

describe("seededShuffle", () => {
  it("is reproducible for a seed, so a generated paper can be explained", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    expect(seededShuffle(42)([...items])).toEqual(seededShuffle(42)([...items]));
  });

  it("differs between seeds, and keeps every element", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    const a = seededShuffle(1)([...items]);
    const b = seededShuffle(999)([...items]);
    expect(a).not.toEqual(b);
    expect([...a].sort()).toEqual([...items].sort());
  });
});

describe("isObjective", () => {
  it("is true only for questions a machine can actually mark", () => {
    expect(isObjective("MCQ")).toBe(true);
    expect(isObjective("TRUE_FALSE")).toBe(true);
    expect(isObjective("SHORT_ANSWER")).toBe(false);
    expect(isObjective("ESSAY")).toBe(false);
  });
});
