import { describe, expect, it } from "vitest";
import {
  availableFrom,
  checkCanBorrow,
  checkTotalCopiesChange,
  daysOverdue,
  dueDateFrom,
  fineMinor,
  loanState,
} from "@/modules/operations/library";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const at = (iso: string) => new Date(iso);

describe("dueDateFrom", () => {
  it("adds the loan period from the start of the issue day", () => {
    expect(dueDateFrom(at("2026-09-14T15:42:00.000Z"), 14).toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });

  it("crosses a month boundary", () => {
    expect(dueDateFrom(d("2026-09-25"), 14).toISOString().slice(0, 10)).toBe("2026-10-09");
  });
});

describe("daysOverdue", () => {
  it("is zero on the due date itself", () => {
    expect(daysOverdue({ dueAt: d("2026-09-28"), returnedAt: null }, d("2026-09-28"))).toBe(0);
  });

  it("counts whole days past the due date", () => {
    expect(daysOverdue({ dueAt: d("2026-09-28"), returnedAt: null }, d("2026-10-01"))).toBe(3);
  });

  it("ignores the time of day", () => {
    expect(daysOverdue({ dueAt: d("2026-09-28"), returnedAt: null }, at("2026-09-29T23:59:00.000Z"))).toBe(1);
  });

  it("freezes at the return date once returned, however long ago", () => {
    const loan = { dueAt: d("2026-09-28"), returnedAt: d("2026-09-30") };
    expect(daysOverdue(loan, d("2026-12-25"))).toBe(2);
  });

  it("is zero for a book returned early", () => {
    expect(daysOverdue({ dueAt: d("2026-09-28"), returnedAt: d("2026-09-20") }, d("2026-10-10"))).toBe(0);
  });
});

describe("loanState", () => {
  const dueAt = d("2026-09-28");
  it("distinguishes on loan, due today, overdue and returned", () => {
    expect(loanState({ dueAt, returnedAt: null }, d("2026-09-20"))).toBe("on_loan");
    expect(loanState({ dueAt, returnedAt: null }, d("2026-09-28"))).toBe("due_today");
    expect(loanState({ dueAt, returnedAt: null }, d("2026-09-29"))).toBe("overdue");
    expect(loanState({ dueAt, returnedAt: d("2026-10-05") }, d("2026-10-10"))).toBe("returned");
  });
});

describe("fineMinor", () => {
  it("charges per whole day overdue", () => {
    // ₹2.00/day, 3 days late
    expect(fineMinor({ dueAt: d("2026-09-28"), returnedAt: null }, d("2026-10-01"), 200)).toBe(600);
  });

  it("is zero when not overdue, and zero when the school fines nothing", () => {
    expect(fineMinor({ dueAt: d("2026-09-28"), returnedAt: null }, d("2026-09-28"), 200)).toBe(0);
    expect(fineMinor({ dueAt: d("2026-09-28"), returnedAt: null }, d("2026-10-01"), 0)).toBe(0);
  });
});

describe("checkCanBorrow", () => {
  const base = { availableCopies: 2, openLoansByBorrower: 0, alreadyHasThisTitle: false };

  it("allows a normal borrow", () => {
    expect(checkCanBorrow(base)).toEqual({ ok: true });
  });

  it("refuses when no copy is free", () => {
    const r = checkCanBorrow({ ...base, availableCopies: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/No copies/);
  });

  it("refuses a second copy of the same title", () => {
    const r = checkCanBorrow({ ...base, alreadyHasThisTitle: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/already has a copy of this title/);
  });

  it("enforces the per-borrower limit and names the count", () => {
    const r = checkCanBorrow({ ...base, openLoansByBorrower: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/limit 3/);
    expect(checkCanBorrow({ ...base, openLoansByBorrower: 3, limit: 5 }).ok).toBe(true);
  });
});

describe("checkTotalCopiesChange", () => {
  it("refuses to strand copies that are on loan", () => {
    const r = checkTotalCopiesChange({ newTotal: 1, onLoan: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/on loan/);
  });

  it("allows shrinking down to exactly what is out", () => {
    expect(checkTotalCopiesChange({ newTotal: 2, onLoan: 2 }).ok).toBe(true);
  });

  it("rejects a negative or fractional total", () => {
    expect(checkTotalCopiesChange({ newTotal: -1, onLoan: 0 }).ok).toBe(false);
    expect(checkTotalCopiesChange({ newTotal: 1.5, onLoan: 0 }).ok).toBe(false);
  });
});

describe("availableFrom", () => {
  it("derives availability and never goes negative", () => {
    expect(availableFrom(5, 2)).toBe(3);
    expect(availableFrom(2, 5)).toBe(0);
  });
});
