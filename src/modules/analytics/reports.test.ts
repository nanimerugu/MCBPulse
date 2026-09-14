import { describe, expect, it } from "vitest";
import { MAX_RANGE_DAYS, parseRange, rate, REPORTS, reportFor } from "@/modules/analytics/reports";

const TODAY = new Date("2026-09-14T10:00:00.000Z");

describe("report catalogue", () => {
  it("every report declares a permission and at least one column", () => {
    // The catalogue is the access-control surface: a report without a
    // permission would be readable by anyone who can open the page.
    for (const r of REPORTS) {
      expect(r.requires.module).toBeTruthy();
      expect(r.requires.action).toBeTruthy();
      expect(r.columns.length).toBeGreaterThan(0);
    }
  });

  it("has unique keys", () => {
    expect(new Set(REPORTS.map((r) => r.key)).size).toBe(REPORTS.length);
  });

  it("resolves a known key and refuses an unknown one", () => {
    expect(reportFor("defaulters")?.name).toBe("Fee defaulters");
    expect(reportFor("../../etc/passwd")).toBeNull();
    expect(reportFor("")).toBeNull();
  });
});

describe("rate", () => {
  it("is a percentage, and an em-dash rather than NaN at zero", () => {
    expect(rate(3, 4)).toBe("75%");
    expect(rate(0, 0)).toBe("—");
    expect(rate(5, 0)).toBe("—");
  });
});

describe("parseRange", () => {
  it("defaults to the last 30 days", () => {
    const r = parseRange(undefined, undefined, TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.range.to).toBe("2026-09-14");
      expect(r.range.from).toBe("2026-08-15");
    }
  });

  it("accepts a valid explicit range", () => {
    const r = parseRange("2026-09-01", "2026-09-10", TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.range).toEqual({ from: "2026-09-01", to: "2026-09-10" });
  });

  it("rejects a backwards range", () => {
    const r = parseRange("2026-09-10", "2026-09-01", TODAY);
    expect(r.ok).toBe(false);
  });

  it("caps the range so a report can't pull the whole table", () => {
    expect(parseRange("2020-01-01", "2026-09-14", TODAY).ok).toBe(false);
  });

  it("allows exactly the maximum", () => {
    const from = new Date(Date.parse("2026-09-14T00:00:00Z") - (MAX_RANGE_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
    expect(parseRange(from, "2026-09-14", TODAY).ok).toBe(true);
  });

  it("ignores junk rather than passing it through to a query", () => {
    const r = parseRange("'; DROP TABLE Student; --", "not-a-date", TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.range.from).toBe("2026-08-15");
      expect(r.range.to).toBe("2026-09-14");
    }
  });
});
