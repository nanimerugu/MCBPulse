import { describe, expect, it } from "vitest";
import { dateWithin, defaultStatus, formatRate, summarize, summarizeByStudent } from "@/modules/academics/attendance-summary";

describe("summarize", () => {
  it("counts late as attended and leaves excused out of the denominator", () => {
    const c = summarize(["PRESENT", "PRESENT", "LATE", "ABSENT", "EXCUSED"]);
    expect(c).toMatchObject({ total: 5, present: 2, late: 1, absent: 1, excused: 1 });
    // (2 present + 1 late) / (5 - 1 excused) = 0.75
    expect(c.attendedRate).toBeCloseTo(0.75);
  });

  it("has no rate when there is nothing to count, or only excused days", () => {
    expect(summarize([]).attendedRate).toBeNull();
    expect(summarize(["EXCUSED", "EXCUSED"]).attendedRate).toBeNull();
  });
});

describe("summarizeByStudent", () => {
  it("groups records per student", () => {
    const m = summarizeByStudent([
      { studentId: "a", status: "PRESENT" },
      { studentId: "b", status: "ABSENT" },
      { studentId: "a", status: "ABSENT" },
    ]);
    expect(m.get("a")?.attendedRate).toBeCloseTo(0.5);
    expect(m.get("b")?.attendedRate).toBe(0);
    expect(m.has("c")).toBe(false);
  });
});

describe("helpers", () => {
  it("pre-fills excused for approved leave", () => {
    expect(defaultStatus(true)).toBe("EXCUSED");
    expect(defaultStatus(false)).toBe("PRESENT");
  });

  it("formats rates as whole percentages", () => {
    expect(formatRate(0.756)).toBe("76%");
    expect(formatRate(null)).toBe("—");
  });

  it("treats leave ranges as inclusive", () => {
    expect(dateWithin("2026-09-14", "2026-09-14", "2026-09-16")).toBe(true);
    expect(dateWithin("2026-09-16", "2026-09-14", "2026-09-16")).toBe(true);
    expect(dateWithin("2026-09-17", "2026-09-14", "2026-09-16")).toBe(false);
  });
});
