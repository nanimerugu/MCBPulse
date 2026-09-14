import type { AttendanceStatus } from "@/generated/prisma/enums";

/**
 * Attendance arithmetic (blueprint 11.3 "attendance analytics"), kept pure
 * so a report and the Student 360 stat can't disagree about what "present"
 * means: PRESENT and LATE both count as attended; ABSENT and EXCUSED do not.
 * Excused absences are excluded from the denominator — a child on approved
 * leave shouldn't see their attendance rate fall.
 */

export const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  LATE: "Late",
  EXCUSED: "Excused",
};

export function isAttendanceStatus(value: string): value is AttendanceStatus {
  return (ATTENDANCE_STATUSES as readonly string[]).includes(value);
}

export interface AttendanceCounts {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  /** (present + late) / (total - excused), or null when there is nothing to count. */
  attendedRate: number | null;
}

export function summarize(statuses: readonly AttendanceStatus[]): AttendanceCounts {
  const counts: AttendanceCounts = { total: statuses.length, present: 0, absent: 0, late: 0, excused: 0, attendedRate: null };
  for (const s of statuses) {
    if (s === "PRESENT") counts.present++;
    else if (s === "ABSENT") counts.absent++;
    else if (s === "LATE") counts.late++;
    else counts.excused++;
  }
  const denominator = counts.total - counts.excused;
  counts.attendedRate = denominator > 0 ? (counts.present + counts.late) / denominator : null;
  return counts;
}

export function summarizeByStudent(
  records: readonly { studentId: string; status: AttendanceStatus }[],
): Map<string, AttendanceCounts> {
  const grouped = new Map<string, AttendanceStatus[]>();
  for (const r of records) {
    const list = grouped.get(r.studentId) ?? [];
    list.push(r.status);
    grouped.set(r.studentId, list);
  }
  const out = new Map<string, AttendanceCounts>();
  for (const [studentId, statuses] of grouped) out.set(studentId, summarize(statuses));
  return out;
}

/** Default mark when a register is first opened: approved leave pre-fills Excused. */
export function defaultStatus(hasApprovedLeave: boolean): AttendanceStatus {
  return hasApprovedLeave ? "EXCUSED" : "PRESENT";
}

export function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

/** Inclusive: does [from, to] cover `date`? All three are yyyy-mm-dd strings. */
export function dateWithin(date: string, from: string, to: string): boolean {
  return from <= date && date <= to;
}
