import { describe, expect, it } from "vitest";
import {
  coverState,
  dayOfWeekForISODate,
  isLessonTeacher,
  rankSubstitutes,
  registerWindow,
  timesOverlap,
  type CandidateFacts,
  type LessonToCover,
} from "@/modules/academics/substitution";

const maths: LessonToCover = { startTime: "09:00", endTime: "09:45", subjectId: "MAT", sectionId: "5A", absentStaffId: "ravi" };

const person = (over: Partial<CandidateFacts> & { staffId: string; name: string }): CandidateFacts => ({
  ownLessons: [],
  covering: [],
  onLeave: false,
  teachesSubject: false,
  teachesSection: false,
  ...over,
});

describe("dayOfWeekForISODate", () => {
  it("reads the calendar date, whatever zone the server is in", () => {
    expect(dayOfWeekForISODate("2026-09-14")).toBe("MONDAY");
    expect(dayOfWeekForISODate("2026-09-20")).toBe("SUNDAY");
    expect(dayOfWeekForISODate("2026-01-01")).toBe("THURSDAY");
  });
});

describe("timesOverlap", () => {
  it("is half-open: back-to-back lessons don't clash", () => {
    expect(timesOverlap({ startTime: "09:00", endTime: "09:45" }, { startTime: "09:45", endTime: "10:30" })).toBe(false);
    expect(timesOverlap({ startTime: "09:00", endTime: "09:45" }, { startTime: "09:30", endTime: "10:15" })).toBe(true);
    expect(timesOverlap({ startTime: "09:00", endTime: "10:00" }, { startTime: "09:15", endTime: "09:30" })).toBe(true);
  });
});

describe("rankSubstitutes", () => {
  it("never suggests the absent teacher as their own cover", () => {
    const ranked = rankSubstitutes(maths, [person({ staffId: "ravi", name: "Ravi" }), person({ staffId: "latha", name: "Latha" })]);
    expect(ranked.map((r) => r.staffId)).toEqual(["latha"]);
  });

  it("puts anyone free above anyone busy, and says why the busy ones are out", () => {
    const ranked = rankSubstitutes(maths, [
      person({ staffId: "a", name: "Asha", teachesSubject: true, ownLessons: [{ startTime: "09:15", endTime: "10:00" }] }),
      person({ staffId: "b", name: "Bina", onLeave: true }),
      person({ staffId: "c", name: "Chitra", covering: [{ startTime: "08:30", endTime: "09:30" }] }),
      person({ staffId: "d", name: "Deepak" }),
    ]);
    expect(ranked[0]!.staffId).toBe("d");
    expect(ranked[0]!.available).toBe(true);
    const byId = Object.fromEntries(ranked.map((r) => [r.staffId, r]));
    expect(byId.a!.blockers).toEqual(["teaching"]);
    expect(byId.b!.blockers).toEqual(["on_leave"]);
    expect(byId.c!.blockers).toEqual(["covering"]);
  });

  it("prefers a subject specialist, then someone who knows the class, then the lightest day", () => {
    const ranked = rankSubstitutes(maths, [
      person({ staffId: "free-busy-day", name: "Anil", ownLessons: [{ startTime: "11:00", endTime: "11:45" }, { startTime: "12:00", endTime: "12:45" }] }),
      person({ staffId: "knows-class", name: "Bala", teachesSection: true }),
      person({ staffId: "specialist", name: "Cyrus", teachesSubject: true, ownLessons: [{ startTime: "13:00", endTime: "13:45" }] }),
      person({ staffId: "free-light-day", name: "Dia" }),
    ]);
    expect(ranked.map((r) => r.staffId)).toEqual(["specialist", "knows-class", "free-light-day", "free-busy-day"]);
    expect(ranked[0]!.strengths).toContain("teaches this subject");
  });

  it("lessons at other times of day don't block", () => {
    const ranked = rankSubstitutes(maths, [person({ staffId: "x", name: "X", ownLessons: [{ startTime: "11:00", endTime: "11:45" }] })]);
    expect(ranked[0]!.available).toBe(true);
  });
});

describe("coverState", () => {
  const away = new Set(["ravi"]);
  it("flags an uncovered lesson whose teacher is on leave", () => {
    expect(coverState({ staffId: "ravi" }, away, false)).toBe("needs_cover");
    expect(coverState({ staffId: "ravi" }, away, true)).toBe("covered");
    expect(coverState({ staffId: "asha" }, away, false)).toBe("normal");
  });

  it("counts arranged cover even when no leave was recorded (a teacher off sick this morning)", () => {
    expect(coverState({ staffId: "asha" }, away, true)).toBe("covered");
  });
});

describe("registerWindow", () => {
  it("is open on the day", () => {
    expect(registerWindow({ lessonDateISO: "2026-09-14", todayISO: "2026-09-14", canApprove: false }).ok).toBe(true);
  });

  it("refuses a register for a lesson that hasn't happened, even with approval", () => {
    expect(registerWindow({ lessonDateISO: "2026-09-15", todayISO: "2026-09-14", canApprove: true }).ok).toBe(false);
  });

  it("allows changing a past lesson only with approval rights", () => {
    expect(registerWindow({ lessonDateISO: "2026-09-11", todayISO: "2026-09-14", canApprove: false }).ok).toBe(false);
    expect(registerWindow({ lessonDateISO: "2026-09-11", todayISO: "2026-09-14", canApprove: true }).ok).toBe(true);
  });
});

describe("isLessonTeacher", () => {
  it("is the timetabled teacher when nobody is covering", () => {
    expect(isLessonTeacher({ viewerStaffId: "ravi", slotStaffId: "ravi", coverStaffId: null })).toBe(true);
    expect(isLessonTeacher({ viewerStaffId: "latha", slotStaffId: "ravi", coverStaffId: null })).toBe(false);
  });

  it("is the SUBSTITUTE once cover is arranged — not the teacher who is away", () => {
    expect(isLessonTeacher({ viewerStaffId: "latha", slotStaffId: "ravi", coverStaffId: "latha" })).toBe(true);
    expect(isLessonTeacher({ viewerStaffId: "ravi", slotStaffId: "ravi", coverStaffId: "latha" })).toBe(false);
  });

  it("is never someone without a staff record", () => {
    expect(isLessonTeacher({ viewerStaffId: null, slotStaffId: "ravi", coverStaffId: null })).toBe(false);
  });
});
