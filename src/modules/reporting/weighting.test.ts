import { describe, expect, it } from "vitest";
import { checkWeights, describeWeights, overallResult, subjectResult, weightsOf } from "@/modules/reporting/weighting";
import { parseBandLines } from "@/modules/reporting/band-input";
import { checkScale } from "@/modules/reporting/grading-scale";

const W8020 = { exam: 80, coursework: 20 };

describe("checkWeights", () => {
  it("treats both blank as 'add marks together'", () => {
    expect(checkWeights("", "  ")).toEqual({ ok: true, weights: null });
    expect(checkWeights(undefined, undefined)).toEqual({ ok: true, weights: null });
  });

  it("accepts whole percentages that add up to 100, including 100/0", () => {
    expect(checkWeights("80", "20")).toEqual({ ok: true, weights: W8020 });
    expect(checkWeights("100", "0")).toEqual({ ok: true, weights: { exam: 100, coursework: 0 } });
  });

  it("refuses half a weighting, fractions, and totals other than 100", () => {
    expect(checkWeights("80", "").ok).toBe(false);
    expect(checkWeights("70.5", "29.5").ok).toBe(false);
    const off = checkWeights("80", "30");
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.message).toContain("110");
  });
});

describe("subjectResult — added together", () => {
  it("matches the original sum rule", () => {
    expect(subjectResult({ examMarks: 40, examMax: 50, assignmentMarks: 8, assignmentMax: 10 }, null)).toEqual({ percent: 80, basis: "both", note: null });
  });

  it("is null, not 0%, with no evidence", () => {
    expect(subjectResult({ examMarks: null, examMax: null, assignmentMarks: null, assignmentMax: null }, null).percent).toBeNull();
  });
});

describe("subjectResult — weighted", () => {
  it("blends component PERCENTAGES, whatever each was marked out of", () => {
    // Exams 80%, coursework 50%. At 80/20: 64 + 10 = 74.
    // Added together it would be (40+5)/(50+10) = 75 — and flip wildly if
    // coursework were out of 100 instead of 10.
    expect(subjectResult({ examMarks: 40, examMax: 50, assignmentMarks: 5, assignmentMax: 10 }, W8020).percent).toBe(74);
    expect(subjectResult({ examMarks: 40, examMax: 50, assignmentMarks: 50, assignmentMax: 100 }, W8020).percent).toBe(74);
  });

  it("uses the one component that exists, and SAYS so", () => {
    const r = subjectResult({ examMarks: 45, examMax: 50, assignmentMarks: null, assignmentMax: null }, W8020);
    // Not 72 (90% × 0.8, as if the missing coursework were zero).
    expect(r.percent).toBe(90);
    expect(r.basis).toBe("exam_only");
    expect(r.note).toMatch(/Exams only/);
    expect(r.note).toMatch(/80\/20/);
  });

  it("refuses to grade from a component the scale gives no weight", () => {
    const r = subjectResult({ examMarks: null, examMax: null, assignmentMarks: 9, assignmentMax: 10 }, { exam: 100, coursework: 0 });
    expect(r.percent).toBeNull();
    expect(r.note).toMatch(/no weight/);
  });

  it("a zero-weight component present alongside the other simply doesn't count", () => {
    expect(subjectResult({ examMarks: 30, examMax: 50, assignmentMarks: 10, assignmentMax: 10 }, { exam: 100, coursework: 0 }).percent).toBe(60);
  });
});

describe("overallResult", () => {
  const subjects = [
    { examMarks: 90, examMax: 100, assignmentMarks: null, assignmentMax: null }, // 90%
    { examMarks: 5, examMax: 10, assignmentMarks: null, assignmentMax: null }, // 50%
  ];

  it("added together: weights by marks available (unchanged behaviour)", () => {
    expect(overallResult(subjects, null)).toBe(86); // 95/110
  });

  it("weighted: every subject counts equally", () => {
    expect(overallResult(subjects, W8020)).toBe(70); // mean of 90 and 50
  });

  it("ignores ungradeable subjects instead of counting them as zero", () => {
    const withBlank = [...subjects, { examMarks: null, examMax: null, assignmentMarks: null, assignmentMax: null }];
    expect(overallResult(withBlank, W8020)).toBe(70);
    expect(overallResult([], W8020)).toBeNull();
  });
});

describe("weightsOf / describeWeights", () => {
  it("round-trips the stored columns", () => {
    expect(weightsOf({ examWeight: 80, courseworkWeight: 20 })).toEqual(W8020);
    expect(weightsOf({ examWeight: null, courseworkWeight: null })).toBeNull();
    expect(describeWeights(W8020)).toBe("Exams 80% · Coursework 20%");
    expect(describeWeights(null)).toMatch(/added together/);
  });
});

describe("parseBandLines", () => {
  it("reads a pasted scale with commas or spaces", () => {
    const r = parseBandLines("A1, 91, Outstanding\nA2 81 Excellent\n\nE 0");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bands).toEqual([
        { label: "A1", minPercent: 91, description: "Outstanding" },
        { label: "A2", minPercent: 81, description: "Excellent" },
        { label: "E", minPercent: 0, description: null },
      ]);
      expect(checkScale(r.bands)).toBeNull();
    }
  });

  it("reports EVERY bad line with its number", () => {
    const r = parseBandLines("A1 91\nnonsense\nB 150\nC 40.5");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(3);
      expect(r.errors[0]).toMatch(/^Line 2/);
      expect(r.errors[1]).toMatch(/^Line 3/);
      expect(r.errors[2]).toMatch(/^Line 4/);
    }
  });

  it("accepts a trailing % sign", () => {
    const r = parseBandLines("Pass 40% \nFail 0%");
    expect(r.ok && r.bands.map((b) => b.minPercent)).toEqual([40, 0]);
  });
});
