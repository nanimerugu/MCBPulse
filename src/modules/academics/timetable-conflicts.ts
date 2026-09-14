import type { DayOfWeek } from "@/generated/prisma/enums";

/**
 * Timetable conflict detection (blueprint 11.4: "conflict detection for
 * teacher, room, class and subject"). Pure — the service loads the existing
 * slots for the day and asks; nothing here touches the database.
 *
 * Times are "HH:mm" strings, compared as minutes-since-midnight. Two slots
 * overlap when one starts before the other ends and vice versa; a slot that
 * ends exactly when the next begins does not overlap.
 */

export const DAYS: readonly DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

export const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};

export function isDayOfWeek(value: string): value is DayOfWeek {
  return (DAYS as readonly string[]).includes(value);
}

/** JS getDay() is Sunday=0; the enum starts at Monday. */
export function dayOfWeekFor(date: Date): DayOfWeek {
  return DAYS[(date.getDay() + 6) % 7];
}

export function toMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function isValidTimeRange(start: string, end: string): boolean {
  const s = toMinutes(start);
  const e = toMinutes(end);
  return s !== null && e !== null && e > s;
}

export interface SlotLike {
  id?: string;
  sectionId: string;
  staffId: string;
  room: string | null;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
}

export function overlaps(a: SlotLike, b: SlotLike): boolean {
  if (a.dayOfWeek !== b.dayOfWeek) return false;
  const aS = toMinutes(a.startTime);
  const aE = toMinutes(a.endTime);
  const bS = toMinutes(b.startTime);
  const bE = toMinutes(b.endTime);
  if (aS === null || aE === null || bS === null || bE === null) return false;
  return aS < bE && bS < aE;
}

export type ConflictKind = "section" | "teacher" | "room";

export interface Conflict {
  kind: ConflictKind;
  with: SlotLike;
}

/**
 * Every way `candidate` collides with `existing`. A slot never conflicts
 * with itself (matched by id), so this works for edits as well as inserts.
 * Room conflicts only count when both slots name the same non-empty room —
 * an unnamed room is "somewhere", not "the same somewhere".
 */
export function findConflicts(candidate: SlotLike, existing: readonly SlotLike[]): Conflict[] {
  const out: Conflict[] = [];
  for (const other of existing) {
    if (candidate.id && other.id === candidate.id) continue;
    if (!overlaps(candidate, other)) continue;
    if (other.sectionId === candidate.sectionId) out.push({ kind: "section", with: other });
    if (other.staffId === candidate.staffId) out.push({ kind: "teacher", with: other });
    const room = candidate.room?.trim();
    if (room && other.room?.trim().toLowerCase() === room.toLowerCase()) out.push({ kind: "room", with: other });
  }
  return out;
}

export const CONFLICT_LABELS: Record<ConflictKind, string> = {
  section: "the section already has a class then",
  teacher: "the teacher is already teaching then",
  room: "the room is already in use then",
};
