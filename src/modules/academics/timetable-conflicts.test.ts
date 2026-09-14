import { describe, expect, it } from "vitest";
import {
  dayOfWeekFor,
  findConflicts,
  isValidTimeRange,
  overlaps,
  toMinutes,
  type SlotLike,
} from "@/modules/academics/timetable-conflicts";

const base: SlotLike = {
  id: "s1",
  sectionId: "sec-5a",
  staffId: "t1",
  room: "R-12",
  dayOfWeek: "MONDAY",
  startTime: "09:00",
  endTime: "09:45",
};

describe("time helpers", () => {
  it("parses HH:mm and rejects nonsense", () => {
    expect(toMinutes("09:05")).toBe(545);
    expect(toMinutes("23:59")).toBe(1439);
    expect(toMinutes("24:00")).toBeNull();
    expect(toMinutes("9:00")).toBeNull();
    expect(toMinutes("09:60")).toBeNull();
  });

  it("requires end after start", () => {
    expect(isValidTimeRange("09:00", "09:45")).toBe(true);
    expect(isValidTimeRange("09:45", "09:45")).toBe(false);
    expect(isValidTimeRange("10:00", "09:00")).toBe(false);
  });

  it("maps JS Sunday=0 onto the Monday-first enum", () => {
    expect(dayOfWeekFor(new Date(2026, 8, 14))).toBe("MONDAY"); // 14 Sep 2026 is a Monday
    expect(dayOfWeekFor(new Date(2026, 8, 13))).toBe("SUNDAY");
  });
});

describe("overlaps", () => {
  it("does not overlap when one ends exactly as the other starts", () => {
    expect(overlaps(base, { ...base, id: "s2", startTime: "09:45", endTime: "10:30" })).toBe(false);
  });

  it("overlaps on any shared minute of the same day", () => {
    expect(overlaps(base, { ...base, id: "s2", startTime: "09:30", endTime: "10:15" })).toBe(true);
    expect(overlaps(base, { ...base, id: "s2", startTime: "08:30", endTime: "09:01" })).toBe(true);
  });

  it("never overlaps across days", () => {
    expect(overlaps(base, { ...base, id: "s2", dayOfWeek: "TUESDAY" })).toBe(false);
  });
});

describe("findConflicts", () => {
  it("flags the section being double-booked", () => {
    const other: SlotLike = { ...base, id: "s2", staffId: "t2", room: null, startTime: "09:30", endTime: "10:15" };
    expect(findConflicts({ ...base, id: undefined }, [other]).map((c) => c.kind)).toEqual(["section"]);
  });

  it("flags the teacher being in two sections at once", () => {
    const other: SlotLike = { ...base, id: "s2", sectionId: "sec-3b", room: null };
    expect(findConflicts({ ...base, id: undefined }, [other]).map((c) => c.kind)).toEqual(["teacher"]);
  });

  it("flags the same room, case-insensitively, but not an unnamed room", () => {
    const sameRoom: SlotLike = { ...base, id: "s2", sectionId: "sec-3b", staffId: "t2", room: "r-12" };
    const noRoom: SlotLike = { ...base, id: "s3", sectionId: "sec-3b", staffId: "t2", room: null };
    expect(findConflicts({ ...base, id: undefined }, [sameRoom]).map((c) => c.kind)).toEqual(["room"]);
    expect(findConflicts({ ...base, id: undefined, room: null }, [noRoom])).toEqual([]);
  });

  it("can report several kinds against one slot, and skips itself on edit", () => {
    const other: SlotLike = { ...base, id: "s2" }; // same section, teacher and room
    expect(findConflicts({ ...base, id: undefined }, [other]).map((c) => c.kind).sort()).toEqual(["room", "section", "teacher"]);
    expect(findConflicts(base, [base])).toEqual([]);
  });
});
