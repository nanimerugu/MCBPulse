import { describe, expect, it } from "vitest";
import { daysWithinPeriod, findClash, leaveDayCount, rangesOverlap, toUtcDate, validateLeaveRange } from "@/modules/hr/leave";

const range = (from: string, to: string) => ({ fromDate: toUtcDate(from), toDate: toUtcDate(to) });

describe("leaveDayCount", () => {
  it("counts both ends, so a one-day leave is one day", () => {
    expect(leaveDayCount(range("2026-09-14", "2026-09-14"))).toBe(1);
    expect(leaveDayCount(range("2026-09-14", "2026-09-16"))).toBe(3);
  });

  it("spans a month boundary correctly", () => {
    expect(leaveDayCount(range("2026-09-29", "2026-10-02"))).toBe(4);
  });

  it("returns zero rather than a negative for a backwards range", () => {
    expect(leaveDayCount(range("2026-09-16", "2026-09-14"))).toBe(0);
  });
});

describe("rangesOverlap", () => {
  it("counts a shared endpoint as an overlap", () => {
    expect(rangesOverlap(range("2026-09-10", "2026-09-14"), range("2026-09-14", "2026-09-18"))).toBe(true);
  });

  it("is false for adjacent but disjoint ranges", () => {
    expect(rangesOverlap(range("2026-09-10", "2026-09-13"), range("2026-09-14", "2026-09-18"))).toBe(false);
  });

  it("catches full containment in both directions", () => {
    expect(rangesOverlap(range("2026-09-01", "2026-09-30"), range("2026-09-14", "2026-09-15"))).toBe(true);
    expect(rangesOverlap(range("2026-09-14", "2026-09-15"), range("2026-09-01", "2026-09-30"))).toBe(true);
  });
});

describe("findClash", () => {
  const existing = [
    { ...range("2026-09-01", "2026-09-03"), status: "APPROVED" as const, id: "a" },
    { ...range("2026-09-20", "2026-09-22"), status: "PENDING" as const, id: "p" },
    { ...range("2026-09-10", "2026-09-12"), status: "REJECTED" as const, id: "r" },
  ];

  it("blocks against an approved request", () => {
    expect(findClash(range("2026-09-03", "2026-09-05"), existing)?.id).toBe("a");
  });

  it("blocks against a still-pending request", () => {
    expect(findClash(range("2026-09-21", "2026-09-25"), existing)?.id).toBe("p");
  });

  it("does not block against a rejected one — asking again is allowed", () => {
    expect(findClash(range("2026-09-10", "2026-09-12"), existing)).toBeNull();
  });

  it("returns null when nothing overlaps", () => {
    expect(findClash(range("2026-09-14", "2026-09-16"), existing)).toBeNull();
  });
});

describe("validateLeaveRange", () => {
  it("rejects a backwards range with a readable reason", () => {
    const r = validateLeaveRange(range("2026-09-16", "2026-09-14"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/before the start/);
  });

  it("rejects an absurdly long request", () => {
    expect(validateLeaveRange(range("2026-01-01", "2028-01-01")).ok).toBe(false);
  });

  it("accepts a normal request", () => {
    expect(validateLeaveRange(range("2026-09-14", "2026-09-18")).ok).toBe(true);
  });
});

describe("daysWithinPeriod", () => {
  it("clips leave to the payroll month", () => {
    expect(daysWithinPeriod(range("2026-08-28", "2026-09-03"), 9, 2026)).toBe(3);
    expect(daysWithinPeriod(range("2026-09-28", "2026-10-05"), 9, 2026)).toBe(3);
  });

  it("is zero for leave outside the period", () => {
    expect(daysWithinPeriod(range("2026-10-01", "2026-10-05"), 9, 2026)).toBe(0);
  });

  it("handles leave wholly inside the period", () => {
    expect(daysWithinPeriod(range("2026-09-14", "2026-09-16"), 9, 2026)).toBe(3);
  });
});
