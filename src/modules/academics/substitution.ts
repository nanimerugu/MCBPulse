import type { DayOfWeek } from "@/generated/prisma/enums";
import { DAYS, toMinutes } from "@/modules/academics/timetable-conflicts";

/**
 * Cover for absent teachers, and the per-lesson register — the pure half.
 *
 * Choosing a substitute is a morning scramble in most schools: someone reads
 * the leave list, scans every timetable for a free period, and phones round.
 * This module does the scanning. It never CHOOSES — the coordinator does —
 * but it puts the people who are actually free at the top, and says in words
 * why everyone else isn't.
 */

/**
 * The weekday of a calendar date written YYYY-MM-DD.
 *
 * The existing `dayOfWeekFor(Date)` reads the SERVER's local day, which for a
 * date-only value is a day off anywhere west of UTC. A lesson's date is a
 * calendar fact, not an instant, so this reads it in UTC where the string was
 * anchored.
 */
export function dayOfWeekForISODate(iso: string): DayOfWeek {
  return DAYS[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7]!;
}

export interface TimeRange {
  startTime: string;
  endTime: string;
}

/** Half-open: a lesson ending at 10:00 doesn't clash with one starting at 10:00. */
export function timesOverlap(a: TimeRange, b: TimeRange): boolean {
  const aS = toMinutes(a.startTime);
  const aE = toMinutes(a.endTime);
  const bS = toMinutes(b.startTime);
  const bE = toMinutes(b.endTime);
  if (aS === null || aE === null || bS === null || bE === null) return false;
  return aS < bE && bS < aE;
}

export interface LessonToCover extends TimeRange {
  subjectId: string;
  sectionId: string;
  /** The teacher who is away. Never suggested as their own cover. */
  absentStaffId: string;
}

export interface CandidateFacts {
  staffId: string;
  name: string;
  /** Their own timetable on this weekday. */
  ownLessons: TimeRange[];
  /** Lessons they are already covering on this date. */
  covering: TimeRange[];
  /** Approved leave that includes the date. */
  onLeave: boolean;
  /** Holds a teaching assignment for this subject, anywhere. */
  teachesSubject: boolean;
  /** Holds a teaching assignment in this section — they know the class. */
  teachesSection: boolean;
}

export type Blocker = "on_leave" | "teaching" | "covering";

export const BLOCKER_LABELS: Record<Blocker, string> = {
  on_leave: "on approved leave",
  teaching: "teaching their own class then",
  covering: "already covering another lesson then",
};

export interface RankedCandidate {
  staffId: string;
  name: string;
  available: boolean;
  blockers: Blocker[];
  /** Why they are near the top, for the coordinator. */
  strengths: string[];
  /** Lessons (own plus cover) already on their day — a tiebreak for fairness. */
  load: number;
}

export function assessCandidate(target: LessonToCover, c: CandidateFacts): RankedCandidate {
  const blockers: Blocker[] = [];
  if (c.onLeave) blockers.push("on_leave");
  if (c.ownLessons.some((l) => timesOverlap(l, target))) blockers.push("teaching");
  if (c.covering.some((l) => timesOverlap(l, target))) blockers.push("covering");
  const strengths: string[] = [];
  if (c.teachesSubject) strengths.push("teaches this subject");
  if (c.teachesSection) strengths.push("knows this class");
  return { staffId: c.staffId, name: c.name, available: blockers.length === 0, blockers, strengths, load: c.ownLessons.length + c.covering.length };
}

/**
 * Everyone except the absent teacher, available people first.
 *
 * Among the available: a subject specialist beats someone who knows the
 * class, who beats anyone free; then whoever has the lightest day, so the
 * same free teacher isn't handed every cover all term; then by name, so the
 * order is stable. The unavailable are listed too, with the reason, because
 * "why isn't Mrs Rao suggested?" is the first question a coordinator asks.
 */
export function rankSubstitutes(target: LessonToCover, candidates: readonly CandidateFacts[]): RankedCandidate[] {
  const score = (r: RankedCandidate, c: CandidateFacts) => (c.teachesSubject ? 2 : 0) + (c.teachesSection ? 1 : 0);
  return candidates
    .filter((c) => c.staffId !== target.absentStaffId)
    .map((c) => ({ ranked: assessCandidate(target, c), facts: c }))
    .sort((a, b) => {
      if (a.ranked.available !== b.ranked.available) return a.ranked.available ? -1 : 1;
      const s = score(b.ranked, b.facts) - score(a.ranked, a.facts);
      if (s !== 0) return s;
      if (a.ranked.load !== b.ranked.load) return a.ranked.load - b.ranked.load;
      return a.ranked.name.localeCompare(b.ranked.name);
    })
    .map((x) => x.ranked);
}

export type CoverState = "covered" | "needs_cover" | "normal";

/** A lesson whose teacher is on approved leave and has nobody covering it is the one to chase. */
export function coverState(lesson: { staffId: string }, onLeave: ReadonlySet<string>, hasCover: boolean): CoverState {
  if (hasCover) return "covered";
  return onLeave.has(lesson.staffId) ? "needs_cover" : "normal";
}

// --- Period registers ----------------------------------------------------------

export type RegisterWindow = { ok: true } | { ok: false; message: string };

/**
 * When a lesson's register may be written.
 *
 * On the day, by whoever teaches (or covers) the lesson. Never in advance —
 * a register filled in before the lesson is a guess. Afterwards only with
 * approval rights, the same rule as correcting a locked daily register:
 * changing yesterday's record of who was in the room is a correction, not a
 * register.
 */
export function registerWindow(args: { lessonDateISO: string; todayISO: string; canApprove: boolean }): RegisterWindow {
  if (args.lessonDateISO > args.todayISO) return { ok: false, message: "That lesson hasn't happened yet" };
  if (args.lessonDateISO < args.todayISO && !args.canApprove) {
    return { ok: false, message: "Only someone with approval rights can change a past lesson's register" };
  }
  return { ok: true };
}

/** Is the viewer this lesson's teacher for the day — its own teacher, or its cover? */
export function isLessonTeacher(args: { viewerStaffId: string | null; slotStaffId: string; coverStaffId: string | null }): boolean {
  if (!args.viewerStaffId) return false;
  // With cover arranged, the lesson is the substitute's — the absent teacher
  // taking the register from home would be recording a room they weren't in.
  if (args.coverStaffId) return args.viewerStaffId === args.coverStaffId;
  return args.viewerStaffId === args.slotStaffId;
}
