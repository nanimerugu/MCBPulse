import { describe, expect, it } from "vitest";
import { daysInMonth, isValidBillingMonth, libraryFine, monthBounds, monthKey, monthLabel, prorate, SOURCE_KEYS, stayDaysInMonth } from "@/modules/finance/ops-charges";

const SEPT = { year: 2026, month: 9 };
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("libraryFine", () => {
  it("is days late times the rate", () => {
    expect(libraryFine({ daysOverdue: 6, perDayMinor: 500, capMinor: null })).toBe(3000);
  });

  it("never exceeds the cap, however late", () => {
    expect(libraryFine({ daysOverdue: 90, perDayMinor: 500, capMinor: 10000 })).toBe(10000);
    expect(libraryFine({ daysOverdue: 3, perDayMinor: 500, capMinor: 10000 })).toBe(1500);
  });

  it("is nothing when the school sets no rate, or the book was on time", () => {
    expect(libraryFine({ daysOverdue: 10, perDayMinor: null, capMinor: null })).toBe(0);
    expect(libraryFine({ daysOverdue: 10, perDayMinor: 0, capMinor: null })).toBe(0);
    expect(libraryFine({ daysOverdue: 0, perDayMinor: 500, capMinor: null })).toBe(0);
  });
});

describe("months", () => {
  it("knows how long each month is, leap years included", () => {
    expect(daysInMonth(SEPT)).toBe(30);
    expect(daysInMonth({ year: 2028, month: 2 })).toBe(29);
    expect(daysInMonth({ year: 2026, month: 2 })).toBe(28);
  });

  it("gives calendar bounds and stable keys", () => {
    const { start, end } = monthBounds(SEPT);
    expect(start.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(end.toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(monthKey({ year: 2026, month: 3 })).toBe("2026-03");
    expect(monthLabel(SEPT)).toBe("September 2026");
  });

  it("refuses nonsense", () => {
    expect(isValidBillingMonth({ year: 2026, month: 13 })).toBe(false);
    expect(isValidBillingMonth({ year: 1999, month: 1 })).toBe(false);
    expect(isValidBillingMonth(SEPT)).toBe(true);
  });
});

describe("stayDaysInMonth", () => {
  it("counts a whole month for a stay spanning it", () => {
    expect(stayDaysInMonth({ from: d("2026-06-01"), to: null }, SEPT)).toBe(30);
  });

  it("counts both the day in and the day out", () => {
    expect(stayDaysInMonth({ from: d("2026-09-20"), to: null }, SEPT)).toBe(11);
    expect(stayDaysInMonth({ from: d("2026-08-15"), to: d("2026-09-10") }, SEPT)).toBe(10);
    expect(stayDaysInMonth({ from: d("2026-09-14"), to: d("2026-09-14") }, SEPT)).toBe(1);
  });

  it("is zero for a stay outside the month", () => {
    expect(stayDaysInMonth({ from: d("2026-10-01"), to: null }, SEPT)).toBe(0);
    expect(stayDaysInMonth({ from: d("2026-07-01"), to: d("2026-08-31") }, SEPT)).toBe(0);
  });

  it("ignores the time of day a check-in was recorded at", () => {
    expect(stayDaysInMonth({ from: new Date("2026-09-20T17:45:00Z"), to: null }, SEPT)).toBe(11);
  });
});

describe("prorate", () => {
  it("charges a part month in proportion, and a full month in full", () => {
    expect(prorate(600000, 11, 30)).toBe(220000);
    expect(prorate(600000, 30, 30)).toBe(600000);
    expect(prorate(100000, 1, 31)).toBe(3226);
  });

  it("is nothing for no days or no fee", () => {
    expect(prorate(600000, 0, 30)).toBe(0);
    expect(prorate(0, 30, 30)).toBe(0);
  });
});

describe("SOURCE_KEYS", () => {
  it("make one charge per fine, per stay per month, per student per month", () => {
    expect(SOURCE_KEYS.libraryFine("loan-1")).toBe("library-fine:loan-1");
    expect(SOURCE_KEYS.hostel("alloc-1", SEPT)).toBe("hostel:alloc-1:2026-09");
    expect(SOURCE_KEYS.transport("stu-1", SEPT)).toBe("transport:stu-1:2026-09");
    expect(SOURCE_KEYS.hostel("alloc-1", SEPT)).not.toBe(SOURCE_KEYS.hostel("alloc-1", { year: 2026, month: 10 }));
  });
});
