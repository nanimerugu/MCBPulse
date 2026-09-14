import { describe, expect, it } from "vitest";
import { checkNewYearDates, checkPlan, suggestPlan, summarizePlan, type NextYearSection, type PlanStudent } from "@/modules/sis/promotion";

const student = (id: string, gradeSequence: number, sectionName = "A", gradeId = `g${gradeSequence}`): PlanStudent => ({
  studentId: id,
  name: `Student ${id}`,
  admissionNumber: `N-${id}`,
  gradeId,
  gradeName: `Grade ${gradeSequence}`,
  gradeSequence,
  sectionName,
});
const section = (id: string, gradeSequence: number, name: string, capacity: number | null = 30): NextYearSection => ({
  id,
  gradeId: `g${gradeSequence}`,
  gradeName: `Grade ${gradeSequence}`,
  gradeSequence,
  name,
  capacity,
});

const GRADES = [1, 2, 3];
const NEXT = [section("n1A", 1, "A"), section("n2A", 2, "A"), section("n2B", 2, "B"), section("n3A", 3, "A")];

describe("suggestPlan", () => {
  it("moves each student to the same-named section one grade up, and graduates the top grade", () => {
    const rows = suggestPlan([student("a", 1, "A"), student("b", 1, "B"), student("c", 3)], NEXT, GRADES);
    expect(rows.map((r) => [r.student.studentId, r.decision, r.targetSectionId])).toEqual([
      ["a", "PROMOTE", "n2A"],
      ["b", "PROMOTE", "n2B"],
      ["c", "GRADUATE", null],
    ]);
  });

  it("falls back to another section of the next grade, and says so", () => {
    const rows = suggestPlan([student("x", 2, "C")], NEXT, GRADES);
    expect(rows[0]!.targetSectionId).toBe("n3A");
    expect(rows[0]!.note).toMatch(/No section C/);
  });

  it("follows grade ORDER, not names — Grade 10 after Grade 9", () => {
    const next = [section("t10", 10, "A")];
    const rows = suggestPlan([{ ...student("n", 9), gradeName: "Grade 9" }], next, [9, 10, 11]);
    expect(rows[0]!.targetSectionId).toBe("t10");
  });

  it("leaves a student unplaced, with the reason, when next grade has no sections next year", () => {
    const rows = suggestPlan([student("y", 1)], [section("n3A", 3, "A")], GRADES);
    expect(rows[0]!.decision).toBe("UNPLACED");
    expect(rows[0]!.note).toMatch(/no sections next year/);
  });
});

describe("checkPlan", () => {
  const students = [student("a", 1), student("b", 2), student("c", 3)];

  it("accepts a coherent plan", () => {
    const check = checkPlan(
      students,
      [
        { studentId: "a", decision: "PROMOTE", targetSectionId: "n2A" },
        { studentId: "b", decision: "RETAIN", targetSectionId: "n2B" },
        { studentId: "c", decision: "GRADUATE", targetSectionId: null },
      ],
      NEXT,
      GRADES,
    );
    expect(check).toEqual({ ok: true });
  });

  it("reports EVERY problem at once", () => {
    const check = checkPlan(
      students,
      [
        { studentId: "a", decision: "PROMOTE", targetSectionId: "n1A" }, // not higher
        { studentId: "b", decision: "GRADUATE", targetSectionId: null }, // not top grade
        { studentId: "zz", decision: "PROMOTE", targetSectionId: "n2A" }, // stranger
      ],
      NEXT,
      GRADES,
    );
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.problems.some((p) => /higher grade/.test(p))).toBe(true);
      expect(check.problems.some((p) => /only the top grade graduates/.test(p))).toBe(true);
      expect(check.problems.some((p) => /isn't enrolled/.test(p))).toBe(true);
      expect(check.problems.some((p) => /Student c has no decision/.test(p))).toBe(true);
    }
  });

  it("refuses keeping a student back in a different grade, or a section that doesn't exist", () => {
    const check = checkPlan([student("b", 2)], [{ studentId: "b", decision: "RETAIN", targetSectionId: "n3A" }], NEXT, GRADES);
    expect(check.ok).toBe(false);
    const missing = checkPlan([student("b", 2)], [{ studentId: "b", decision: "PROMOTE", targetSectionId: "gone" }], NEXT, GRADES);
    expect(!missing.ok && missing.problems[0]).toMatch(/choose a section/);
  });

  it("refuses overfilling a section", () => {
    const tiny = [section("small", 2, "A", 1), section("n3A", 3, "A")];
    const check = checkPlan(
      [student("a", 1), student("b", 1)],
      [
        { studentId: "a", decision: "PROMOTE", targetSectionId: "small" },
        { studentId: "b", decision: "PROMOTE", targetSectionId: "small" },
      ],
      tiny,
      GRADES,
    );
    expect(!check.ok && check.problems.join()).toMatch(/would hold 2 but its capacity is 1/);
  });

  it("doesn't let a graduate or an unplaced student carry a section", () => {
    const check = checkPlan([student("c", 3)], [{ studentId: "c", decision: "GRADUATE", targetSectionId: "n3A" }], NEXT, GRADES);
    expect(check.ok).toBe(false);
  });
});

describe("summarizePlan", () => {
  it("counts each decision", () => {
    expect(summarizePlan([{ decision: "PROMOTE" }, { decision: "PROMOTE" }, { decision: "GRADUATE" }])).toEqual({ PROMOTE: 2, RETAIN: 0, GRADUATE: 1, UNPLACED: 0 });
  });
});

describe("checkNewYearDates", () => {
  const existing = [{ name: "2026-2027", startISO: "2026-04-01", endISO: "2027-03-31" }];

  it("accepts a year that follows the current one", () => {
    expect(checkNewYearDates({ startISO: "2027-04-01", endISO: "2028-03-31", existing })).toBeNull();
  });

  it("refuses overlap and backwards dates", () => {
    expect(checkNewYearDates({ startISO: "2027-03-01", endISO: "2028-02-28", existing })).toMatch(/overlap 2026-2027/);
    expect(checkNewYearDates({ startISO: "2028-03-31", endISO: "2027-04-01", existing })).toMatch(/end after/);
  });
});
