import { describe, expect, it } from "vitest";
import { deriveSubmissionStatus, formatPercentage, isLate, summarizeRow, validateMark } from "@/modules/lms/grading";

const due = new Date("2026-09-20T23:59:00.000Z");

describe("deriveSubmissionStatus", () => {
  it("is pending with nothing recorded", () => {
    expect(deriveSubmissionStatus({ submittedAt: null, dueAt: due, marksAwarded: null })).toBe("PENDING");
  });

  it("distinguishes on-time from late by the due instant", () => {
    expect(deriveSubmissionStatus({ submittedAt: new Date("2026-09-20T23:59:00.000Z"), dueAt: due, marksAwarded: null })).toBe("SUBMITTED");
    expect(deriveSubmissionStatus({ submittedAt: new Date("2026-09-20T23:59:01.000Z"), dueAt: due, marksAwarded: null })).toBe("LATE");
  });

  it("becomes graded once a mark exists, including a zero", () => {
    expect(deriveSubmissionStatus({ submittedAt: new Date("2026-09-19"), dueAt: due, marksAwarded: 0 })).toBe("GRADED");
  });

  it("reports lateness separately, so grading doesn't erase it", () => {
    const submittedAt = new Date("2026-09-21T08:00:00.000Z");
    expect(deriveSubmissionStatus({ submittedAt, dueAt: due, marksAwarded: 7 })).toBe("GRADED");
    expect(isLate(submittedAt, due)).toBe(true);
  });
});

describe("validateMark", () => {
  const submitted = new Date("2026-09-19");

  it("accepts a mark within range, including the boundaries", () => {
    expect(validateMark({ marks: 0, maxMarks: 10, submittedAt: submitted })).toBeNull();
    expect(validateMark({ marks: 10, maxMarks: 10, submittedAt: submitted })).toBeNull();
  });

  it("rejects marks outside the range", () => {
    expect(validateMark({ marks: 11, maxMarks: 10, submittedAt: submitted })).toBe("exceeds_max");
    expect(validateMark({ marks: -1, maxMarks: 10, submittedAt: submitted })).toBe("negative");
    expect(validateMark({ marks: Number.NaN, maxMarks: 10, submittedAt: submitted })).toBe("not_a_number");
  });

  it("refuses to grade work that was never handed in, but allows clearing a mark", () => {
    expect(validateMark({ marks: 5, maxMarks: 10, submittedAt: null })).toBe("not_submitted");
    expect(validateMark({ marks: null, maxMarks: 10, submittedAt: null })).toBeNull();
  });
});

describe("summarizeRow", () => {
  it("averages over graded work only, so ungraded assignments don't drag the term average down", () => {
    const t = summarizeRow([
      { marksAwarded: 8, maxMarks: 10, status: "GRADED" },
      { marksAwarded: 12, maxMarks: 20, status: "GRADED" },
      { marksAwarded: null, maxMarks: 50, status: "PENDING" },
    ]);
    expect(t.gradedCount).toBe(2);
    expect(t.awardedMarks).toBe(20);
    expect(t.possibleMarks).toBe(30);
    expect(t.percentage).toBeCloseTo(20 / 30);
    expect(t.pendingCount).toBe(1);
  });

  it("has no percentage before anything is graded", () => {
    expect(summarizeRow([{ marksAwarded: null, maxMarks: 10, status: "SUBMITTED" }]).percentage).toBeNull();
    expect(summarizeRow([]).percentage).toBeNull();
  });

  it("counts late submissions without excluding them from the average", () => {
    const t = summarizeRow([
      { marksAwarded: 5, maxMarks: 10, status: "GRADED" },
      { marksAwarded: null, maxMarks: 10, status: "LATE" },
    ]);
    expect(t.lateCount).toBe(1);
    expect(t.percentage).toBeCloseTo(0.5);
  });

  it("formats percentages, and a missing one as a dash", () => {
    expect(formatPercentage(0.666)).toBe("67%");
    expect(formatPercentage(null)).toBe("—");
  });
});
