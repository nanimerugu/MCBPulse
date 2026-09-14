import type { LeaveRequestStatus } from "@/generated/prisma/enums";
import type { BadgeTone } from "@/components/ui";

/**
 * Staff leave (blueprint 10.7: "leave requests, approvals and balances").
 * Shares the LeaveRequest table with student leave from Phase 2 — the row
 * carries either a studentId or a staffId — but the rules differ, so the
 * logic lives here rather than being bent into academics/leave.service.ts.
 *
 * Dates are handled as whole UTC days. Leave is inclusive of both ends:
 * "14th to 14th" is one day off, not zero.
 */

export interface DateRange {
  fromDate: Date;
  toDate: Date;
}

const DAY_MS = 86_400_000;

export function toUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Inclusive day count. Returns 0 for a backwards range rather than a negative. */
export function leaveDayCount(range: DateRange): number {
  const days = Math.floor((range.toDate.getTime() - range.fromDate.getTime()) / DAY_MS) + 1;
  return days > 0 ? days : 0;
}

/** Two closed intervals overlap unless one ends before the other starts. */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.fromDate.getTime() <= b.toDate.getTime() && b.fromDate.getTime() <= a.toDate.getTime();
}

/**
 * A new request clashes with anything already pending or approved. Rejected
 * requests don't block — asking again after a no is legitimate.
 */
export function findClash<T extends DateRange & { status: LeaveRequestStatus }>(candidate: DateRange, existing: readonly T[]): T | null {
  return existing.find((e) => e.status !== "REJECTED" && rangesOverlap(candidate, e)) ?? null;
}

export type LeaveValidation = { ok: true } | { ok: false; message: string };

export function validateLeaveRange(range: DateRange): LeaveValidation {
  if (Number.isNaN(range.fromDate.getTime()) || Number.isNaN(range.toDate.getTime())) return { ok: false, message: "Pick both dates" };
  if (range.toDate.getTime() < range.fromDate.getTime()) return { ok: false, message: "The end date is before the start date" };
  // A year of leave in one request is a data-entry slip, not a request.
  if (leaveDayCount(range) > 365) return { ok: false, message: "A single request can't cover more than a year" };
  return { ok: true };
}

/** Approved days that fall inside a payroll period — shown on the run for context. */
export function daysWithinPeriod(range: DateRange, month: number, year: number): number {
  const periodStart = Date.UTC(year, month - 1, 1);
  const periodEnd = Date.UTC(year, month, 0);
  const from = Math.max(range.fromDate.getTime(), periodStart);
  const to = Math.min(range.toDate.getTime(), periodEnd);
  if (to < from) return 0;
  return Math.floor((to - from) / DAY_MS) + 1;
}

export const LEAVE_STATUS_LABELS: Record<LeaveRequestStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export const LEAVE_STATUS_TONES: Record<LeaveRequestStatus, BadgeTone> = {
  PENDING: "amber",
  APPROVED: "green",
  REJECTED: "red",
};
