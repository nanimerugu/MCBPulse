import { describe, expect, it } from "vitest";
import { bandFor, checkScale, DEFAULT_BANDS, overallPercent, subjectPercent } from "@/modules/reporting/grading-scale";

describe("bandFor", () => {
  it("picks the band a mark falls into", () => {
    expect(bandFor(95, DEFAULT_BANDS)?.label).toBe("A1");
    expect(bandFor(72, DEFAULT_BANDS)?.label).toBe("B1");
    expect(bandFor(33, DEFAULT_BANDS)?.label).toBe("D");
  });

  it("is inclusive at each threshold", () => {
    expect(bandFor(91, DEFAULT_BANDS)?.label).toBe("A1");
    expect(bandFor(90, DEFAULT_BANDS)?.label).toBe("A2");
  });

  it("covers zero, so a low mark is never ungraded", () => {
    expect(bandFor(0, DEFAULT_BANDS)?.label).toBe("E");
  });

  it("is null for no mark and for an empty scale", () => {
    expect(bandFor(null, DEFAULT_BANDS)).toBeNull();
    expect(bandFor(50, [])).toBeNull();
  });

  it("does not depend on the order the bands are given in", () => {
    const shuffled = [...DEFAULT_BANDS].reverse();
    expect(bandFor(72, shuffled)?.label).toBe("B1");
  });
});

describe("checkScale", () => {
  it("accepts the default scale", () => {
    expect(checkScale(DEFAULT_BANDS)).toBeNull();
  });

  it("rejects an empty scale", () => {
    expect(checkScale([])?.kind).toBe("no_bands");
  });

  it("REJECTS a scale with no band at 0 — a low mark must never be ungraded", () => {
    const noFloor = DEFAULT_BANDS.filter((b) => b.minPercent > 0);
    expect(checkScale(noFloor)?.kind).toBe("no_floor");
  });

  it("rejects duplicate thresholds and duplicate labels", () => {
    expect(checkScale([{ label: "A", minPercent: 0 }, { label: "B", minPercent: 0 }])?.kind).toBe("duplicate_threshold");
    expect(checkScale([{ label: "A", minPercent: 0 }, { label: "a", minPercent: 50 }])?.kind).toBe("duplicate_label");
  });

  it("rejects a threshold outside 0–100", () => {
    expect(checkScale([{ label: "A", minPercent: -1 }])?.kind).toBe("out_of_range");
    expect(checkScale([{ label: "A", minPercent: 101 }])?.kind).toBe("out_of_range");
  });
});

describe("subjectPercent", () => {
  it("sums exam and assignment marks", () => {
    expect(subjectPercent({ subjectName: "Maths", examMarks: 40, examMax: 50, assignmentMarks: 8, assignmentMax: 10 })).toBe(80);
  });

  it("works from exams alone or assignments alone", () => {
    expect(subjectPercent({ subjectName: "M", examMarks: 25, examMax: 50, assignmentMarks: null, assignmentMax: null })).toBe(50);
    expect(subjectPercent({ subjectName: "M", examMarks: null, examMax: null, assignmentMarks: 9, assignmentMax: 10 })).toBe(90);
  });

  it("is null when there is nothing to go on, rather than 0%", () => {
    // Reporting 0% for a subject with no marks would read as a fail.
    expect(subjectPercent({ subjectName: "M", examMarks: null, examMax: null, assignmentMarks: null, assignmentMax: null })).toBeNull();
    expect(subjectPercent({ subjectName: "M", examMarks: 0, examMax: 0, assignmentMarks: 0, assignmentMax: 0 })).toBeNull();
  });

  it("treats a missing component as zero awarded out of its max", () => {
    // A student who sat the exam but handed in no assignment scores 40/60.
    expect(subjectPercent({ subjectName: "M", examMarks: 40, examMax: 50, assignmentMarks: null, assignmentMax: 10 })).toBe(67);
  });
});

describe("overallPercent", () => {
  it("weights by marks available, not by subject count", () => {
    const lines = [
      { subjectName: "A", examMarks: 90, examMax: 100, assignmentMarks: null, assignmentMax: null },
      { subjectName: "B", examMarks: 5, examMax: 10, assignmentMarks: null, assignmentMax: null },
    ];
    // 95/110 = 86%, not the 70% a naive average of 90% and 50% would give.
    expect(overallPercent(lines)).toBe(86);
  });

  it("is null when no subject has any marks", () => {
    expect(overallPercent([{ subjectName: "A", examMarks: null, examMax: null, assignmentMarks: null, assignmentMax: null }])).toBeNull();
    expect(overallPercent([])).toBeNull();
  });
});
