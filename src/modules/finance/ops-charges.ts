/**
 * Operations charges — the arithmetic behind putting a library fine, a
 * hostel month or a bus month on a family's invoice. Pure: the rates come in
 * as data, because every one of them is a school's policy, not this
 * system's.
 *
 * Money is integer minor units (paise), as everywhere in Finance.
 */

const DAY_MS = 86_400_000;

/** A late book's fine: whole days late × the day rate, never more than the cap. */
export function libraryFine(args: { daysOverdue: number; perDayMinor: number | null; capMinor: number | null }): number {
  if (!args.perDayMinor || args.perDayMinor <= 0 || args.daysOverdue <= 0) return 0;
  const raw = args.daysOverdue * args.perDayMinor;
  return args.capMinor !== null && args.capMinor >= 0 ? Math.min(raw, args.capMinor) : raw;
}

export interface BillingMonth {
  year: number;
  month: number; // 1–12
}

export function isValidBillingMonth(m: BillingMonth): boolean {
  return Number.isInteger(m.year) && m.year >= 2000 && m.year <= 2100 && Number.isInteger(m.month) && m.month >= 1 && m.month <= 12;
}

/** "2026-09" — the stable part of a billing idempotency key. */
export function monthKey(m: BillingMonth): string {
  return `${m.year}-${String(m.month).padStart(2, "0")}`;
}

export function daysInMonth(m: BillingMonth): number {
  return new Date(Date.UTC(m.year, m.month, 0)).getUTCDate();
}

/** First and last calendar day of the month, as UTC-midnight Dates. */
export function monthBounds(m: BillingMonth): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(m.year, m.month - 1, 1)), end: new Date(Date.UTC(m.year, m.month - 1, daysInMonth(m))) };
}

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Days of a hostel stay that fall inside the month, counting both the day in
 * and the day out. An open stay (no check-out yet) runs to the month's end.
 * 0 when the stay doesn't touch the month at all.
 */
export function stayDaysInMonth(stay: { from: Date; to: Date | null }, m: BillingMonth): number {
  const { start, end } = monthBounds(m);
  const from = startOfUtcDay(stay.from);
  const to = stay.to ? startOfUtcDay(stay.to) : end;
  const a = Math.max(from.getTime(), start.getTime());
  const b = Math.min(to.getTime(), end.getTime());
  return b < a ? 0 : Math.round((b - a) / DAY_MS) + 1;
}

/**
 * A month's fee for part of the month. A student who moved in on the 20th
 * of a 30-day month is billed 11/30 of it, not all of it — a full month's
 * charge for eleven nights is the kind of invoice a parent rings about.
 */
export function prorate(monthlyMinor: number, days: number, monthDays: number): number {
  if (monthlyMinor <= 0 || days <= 0 || monthDays <= 0) return 0;
  if (days >= monthDays) return monthlyMinor;
  return Math.round((monthlyMinor * days) / monthDays);
}

export const SOURCE_KEYS = {
  libraryFine: (issueId: string) => `library-fine:${issueId}`,
  hostel: (allocationId: string, m: BillingMonth) => `hostel:${allocationId}:${monthKey(m)}`,
  transport: (studentId: string, m: BillingMonth) => `transport:${studentId}:${monthKey(m)}`,
};

export const FEE_HEAD_NAMES = {
  libraryFine: "Library fine",
  hostel: "Hostel fee",
  transport: "Transport fee",
} as const;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthLabel(m: BillingMonth): string {
  return `${MONTHS[m.month - 1]} ${m.year}`;
}
