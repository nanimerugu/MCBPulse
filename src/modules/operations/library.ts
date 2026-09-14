/**
 * Library loan rules (blueprint Phase 8 "Library"). Pure: dates in, decisions
 * out. The service does the writing.
 *
 * Overdue and fines are DERIVED at read time from the due date, never
 * persisted — same rule as an invoice's OVERDUE status in Finance. A stored
 * "overdue" flag needs a nightly job to stay true and is wrong every morning
 * until that job runs.
 */

export const DEFAULT_LOAN_DAYS = 14;
/** Per borrower. A school library lends a handful of books, not a shelf. */
export const DEFAULT_BORROW_LIMIT = 3;

const DAY_MS = 86_400_000;

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function dueDateFrom(issuedAt: Date, loanDays = DEFAULT_LOAN_DAYS): Date {
  return new Date(startOfUtcDay(issuedAt).getTime() + loanDays * DAY_MS);
}

export interface Loan {
  dueAt: Date;
  returnedAt: Date | null;
}

/** Whole days past the due date; 0 while it is still due today. */
export function daysOverdue(loan: Loan, now: Date): number {
  const reference = loan.returnedAt ?? now;
  const days = Math.floor((startOfUtcDay(reference).getTime() - startOfUtcDay(loan.dueAt).getTime()) / DAY_MS);
  return days > 0 ? days : 0;
}

export type LoanState = "returned" | "overdue" | "due_today" | "on_loan";

export function loanState(loan: Loan, now: Date): LoanState {
  if (loan.returnedAt) return "returned";
  if (daysOverdue(loan, now) > 0) return "overdue";
  return startOfUtcDay(loan.dueAt).getTime() === startOfUtcDay(now).getTime() ? "due_today" : "on_loan";
}

export const LOAN_STATE_LABELS: Record<LoanState, string> = {
  returned: "Returned",
  overdue: "Overdue",
  due_today: "Due today",
  on_loan: "On loan",
};

/**
 * Fine in minor units, at a per-day rate. Computed and SHOWN, never charged:
 * turning a fine into an invoice line is a policy decision (does the school
 * fine at all? is it waived for a sibling? does it block a report card?) that
 * this module has no business making on a school's behalf. See the README.
 */
export function fineMinor(loan: Loan, now: Date, ratePerDayMinor: number): number {
  if (ratePerDayMinor <= 0) return 0;
  return daysOverdue(loan, now) * ratePerDayMinor;
}

export type BorrowCheck = { ok: true } | { ok: false; message: string };

export function checkCanBorrow(args: {
  availableCopies: number;
  openLoansByBorrower: number;
  alreadyHasThisTitle: boolean;
  limit?: number;
}): BorrowCheck {
  const limit = args.limit ?? DEFAULT_BORROW_LIMIT;
  if (args.availableCopies <= 0) return { ok: false, message: "No copies are available" };
  if (args.alreadyHasThisTitle) return { ok: false, message: "This borrower already has a copy of this title on loan" };
  if (args.openLoansByBorrower >= limit) {
    return { ok: false, message: `This borrower already has ${args.openLoansByBorrower} book${args.openLoansByBorrower === 1 ? "" : "s"} out (limit ${limit})` };
  }
  return { ok: true };
}

/**
 * Copy counts must satisfy 0 <= available <= total. A catalogue edit that
 * would strand issued copies is refused rather than silently clamped.
 */
export function checkTotalCopiesChange(args: { newTotal: number; onLoan: number }): BorrowCheck {
  if (!Number.isInteger(args.newTotal) || args.newTotal < 0) return { ok: false, message: "Total copies must be zero or more" };
  if (args.newTotal < args.onLoan) {
    return { ok: false, message: `${args.onLoan} cop${args.onLoan === 1 ? "y is" : "ies are"} on loan — total can't be fewer than that` };
  }
  return { ok: true };
}

/** Available copies implied by a total and the number currently out. */
export function availableFrom(total: number, onLoan: number): number {
  return Math.max(0, total - onLoan);
}
