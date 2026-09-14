import { describe, expect, it } from "vitest";
import { daysBetween, formatWallClock, isValidTimeZone, localDateISO, minutesOfDay, toDateTimeLocalValue, zonedLocalToUtc } from "@/lib/time-zone";

const IST = "Asia/Kolkata"; // UTC+05:30, no daylight saving
const NY = "America/New_York"; // has daylight saving

describe("localDateISO", () => {
  it("is the school's calendar date, not UTC's", () => {
    // 20:00 UTC on the 14th is already 01:30 on the 15th in India. A
    // "due tomorrow" reminder computed in UTC would be a day late.
    expect(localDateISO(new Date("2026-09-14T20:00:00Z"), IST)).toBe("2026-09-15");
    expect(localDateISO(new Date("2026-09-14T20:00:00Z"), "UTC")).toBe("2026-09-14");
  });
});

describe("minutesOfDay", () => {
  it("reads the wall clock in the zone", () => {
    expect(minutesOfDay(new Date("2026-09-14T15:30:00Z"), IST)).toBe(21 * 60); // 21:00 IST
    expect(minutesOfDay(new Date("2026-09-14T18:30:00Z"), IST)).toBe(0); // midnight, not 24:00
  });
});

describe("daysBetween", () => {
  it("counts calendar days in either direction", () => {
    expect(daysBetween("2026-09-14", "2026-09-17")).toBe(3);
    expect(daysBetween("2026-09-17", "2026-09-14")).toBe(-3);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
    expect(daysBetween("2026-09-14", "2026-09-14")).toBe(0);
  });
});

describe("zonedLocalToUtc", () => {
  it("turns what a person typed into the instant they meant", () => {
    expect(zonedLocalToUtc("2026-09-15T07:00", IST)?.toISOString()).toBe("2026-09-15T01:30:00.000Z");
    expect(zonedLocalToUtc("2026-09-15T07:00", "UTC")?.toISOString()).toBe("2026-09-15T07:00:00.000Z");
  });

  it("follows daylight saving", () => {
    expect(zonedLocalToUtc("2026-01-15T09:00", NY)?.toISOString()).toBe("2026-01-15T14:00:00.000Z"); // EST
    expect(zonedLocalToUtc("2026-07-15T09:00", NY)?.toISOString()).toBe("2026-07-15T13:00:00.000Z"); // EDT
  });

  it("round-trips through the datetime-local value", () => {
    const at = zonedLocalToUtc("2026-12-31T23:45", IST)!;
    expect(toDateTimeLocalValue(at, IST)).toBe("2026-12-31T23:45");
  });

  it("refuses malformed and impossible dates rather than rolling them over", () => {
    expect(zonedLocalToUtc("2026-02-31T07:00", IST)).toBeNull();
    expect(zonedLocalToUtc("2026-09-15 07:00", IST)).toBeNull();
    expect(zonedLocalToUtc("2026-09-15T24:00", IST)).toBeNull();
    expect(zonedLocalToUtc("", IST)).toBeNull();
  });
});

describe("formatWallClock", () => {
  it("shows the time on the school's clock", () => {
    expect(formatWallClock(new Date("2026-09-15T01:30:00Z"), IST)).toBe("2026-09-15 07:00");
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA names and refuses anything else", () => {
    expect(isValidTimeZone(IST)).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
  });
});
