import { describe, expect, it } from "vitest";
import {
  attemptDeadline,
  autoGrade,
  canTransitionAttempt,
  examWindow,
  summarizeAttempt,
  validateExamMark,
} from "@/modules/examcell/grading";

describe("autoGrade", () => {
  it("awards full marks for the correct option", () => {
    expect(autoGrade({ questionType: "MCQ", marks: 2, selectedOptionId: "o1", correctOptionId: "o1", responseText: null })).toEqual({
      marksAwarded: 2,
      autoGraded: true,
    });
  });

  it("awards zero for the wrong option", () => {
    expect(autoGrade({ questionType: "MCQ", marks: 2, selectedOptionId: "o2", correctOptionId: "o1", responseText: null }).marksAwarded).toBe(0);
  });

  it("treats an unanswered objective question as zero, not ungraded", () => {
    const r = autoGrade({ questionType: "TRUE_FALSE", marks: 1, selectedOptionId: null, correctOptionId: "o1", responseText: null });
    expect(r).toEqual({ marksAwarded: 0, autoGraded: true });
  });

  it("leaves subjective questions for a person", () => {
    for (const type of ["SHORT_ANSWER", "ESSAY"] as const) {
      expect(autoGrade({ questionType: type, marks: 10, selectedOptionId: null, correctOptionId: null, responseText: "an answer" })).toEqual({
        marksAwarded: null,
        autoGraded: false,
      });
    }
  });

  it("refuses to guess when no correct option was recorded", () => {
    // A setup error must not silently mark the whole cohort wrong.
    const r = autoGrade({ questionType: "MCQ", marks: 2, selectedOptionId: "o2", correctOptionId: null, responseText: null });
    expect(r).toEqual({ marksAwarded: null, autoGraded: false });
  });
});

describe("summarizeAttempt", () => {
  it("totals a fully auto-graded attempt", () => {
    const t = summarizeAttempt([
      { marksAwarded: 2, autoGraded: true, marks: 2 },
      { marksAwarded: 0, autoGraded: true, marks: 2 },
    ]);
    expect(t).toMatchObject({ awarded: 2, possible: 4, autoGradedCount: 2, awaitingTeacher: 0 });
    expect(t.percentage).toBeCloseTo(0.5);
  });

  it("withholds a percentage while anything still needs a teacher", () => {
    const t = summarizeAttempt([
      { marksAwarded: 2, autoGraded: true, marks: 2 },
      { marksAwarded: null, autoGraded: false, marks: 10 },
    ]);
    expect(t.awaitingTeacher).toBe(1);
    // A percentage on a half-marked paper is a number that will change,
    // shown as though it won't.
    expect(t.percentage).toBeNull();
  });

  it("handles an empty attempt without dividing by zero", () => {
    expect(summarizeAttempt([]).percentage).toBeNull();
  });
});

describe("validateExamMark", () => {
  it("accepts a mark in range and null", () => {
    expect(validateExamMark(5, 10)).toBeNull();
    expect(validateExamMark(10, 10)).toBeNull();
    expect(validateExamMark(null, 10)).toBeNull();
  });

  it("rejects negative, over-max and non-numbers", () => {
    expect(validateExamMark(-1, 10)).toBe("negative");
    expect(validateExamMark(11, 10)).toBe("exceeds_max");
    expect(validateExamMark(Number.NaN, 10)).toBe("not_a_number");
  });
});

describe("canTransitionAttempt", () => {
  it("follows the lifecycle and refuses skips", () => {
    expect(canTransitionAttempt("NOT_STARTED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionAttempt("IN_PROGRESS", "SUBMITTED")).toBe(true);
    expect(canTransitionAttempt("SUBMITTED", "GRADED")).toBe(true);
    expect(canTransitionAttempt("NOT_STARTED", "SUBMITTED")).toBe(false);
    expect(canTransitionAttempt("GRADED", "IN_PROGRESS")).toBe(false);
    expect(canTransitionAttempt("SUBMITTED", "IN_PROGRESS")).toBe(false);
  });
});

describe("examWindow", () => {
  const scheduled = new Date("2026-09-20T10:00:00.000Z");

  it("is upcoming before, open during, closed after", () => {
    expect(examWindow(scheduled, 60, new Date("2026-09-20T09:59:00.000Z"))).toBe("upcoming");
    expect(examWindow(scheduled, 60, new Date("2026-09-20T10:00:00.000Z"))).toBe("open");
    expect(examWindow(scheduled, 60, new Date("2026-09-20T10:59:00.000Z"))).toBe("open");
    expect(examWindow(scheduled, 60, new Date("2026-09-20T11:00:00.000Z"))).toBe("open");
    expect(examWindow(scheduled, 60, new Date("2026-09-20T11:00:01.000Z"))).toBe("closed");
  });
});

describe("attemptDeadline", () => {
  const scheduled = new Date("2026-09-20T10:00:00.000Z");

  it("gives a punctual student their full duration", () => {
    expect(attemptDeadline(new Date("2026-09-20T10:00:00.000Z"), 60, scheduled).toISOString()).toBe("2026-09-20T11:00:00.000Z");
  });

  it("does not let a late starter run past the end of the exam", () => {
    expect(attemptDeadline(new Date("2026-09-20T10:30:00.000Z"), 60, scheduled).toISOString()).toBe("2026-09-20T11:00:00.000Z");
  });
});
