import { describe, expect, it } from "vitest";
import {
  CATCH_UP_DAYS,
  describeTrigger,
  effectiveOffset,
  EVENT_FIELDS,
  isScheduledKind,
  SCHEDULED_EVENT_KINDS,
  scheduledWindowHit,
  validateOffset,
} from "@/modules/automation/rules";

describe("scheduledWindowHit — due soon", () => {
  it("fires from N days out down to the due date itself", () => {
    expect(scheduledWindowHit("invoice.due_soon", 3, 3)).toBe(true);
    expect(scheduledWindowHit("invoice.due_soon", 3, 1)).toBe(true);
    expect(scheduledWindowHit("invoice.due_soon", 3, 0)).toBe(true);
  });

  it("still reminds about an invoice raised closer to its due date than N", () => {
    // Raised two days before it is due, with a "3 days before" rule: the
    // family still hears, and {{days}} will say 2.
    expect(scheduledWindowHit("invoice.due_soon", 3, 2)).toBe(true);
  });

  it("is silent too early, and once the date has passed", () => {
    expect(scheduledWindowHit("invoice.due_soon", 3, 4)).toBe(false);
    expect(scheduledWindowHit("invoice.due_soon", 3, -1)).toBe(false);
  });
});

describe("scheduledWindowHit — overdue", () => {
  it("fires from day N for a few days of catch-up", () => {
    expect(scheduledWindowHit("invoice.overdue", 7, 7)).toBe(true);
    expect(scheduledWindowHit("invoice.overdue", 7, 7 + CATCH_UP_DAYS)).toBe(true);
    expect(scheduledWindowHit("library.overdue", 3, 4)).toBe(true);
  });

  it("does NOT reach back to old debts when a rule is first created", () => {
    // The mass-mailing case: a new "7 days overdue" rule meeting an invoice
    // that has been unpaid since last year.
    expect(scheduledWindowHit("invoice.overdue", 7, 200)).toBe(false);
    expect(scheduledWindowHit("invoice.overdue", 7, 7 + CATCH_UP_DAYS + 1)).toBe(false);
  });

  it("is silent before day N", () => {
    expect(scheduledWindowHit("invoice.overdue", 7, 6)).toBe(false);
    expect(scheduledWindowHit("invoice.overdue", 7, 0)).toBe(false);
  });
});

describe("validateOffset", () => {
  it("requires a whole number of days in range for a date-based trigger", () => {
    expect(validateOffset("invoice.due_soon", "3")).toEqual({ ok: true, offsetDays: 3 });
    expect(validateOffset("invoice.due_soon", "").ok).toBe(false);
    expect(validateOffset("invoice.due_soon", "0").ok).toBe(false);
    expect(validateOffset("invoice.due_soon", "61").ok).toBe(false);
    expect(validateOffset("invoice.overdue", "2.5").ok).toBe(false);
    expect(validateOffset("library.overdue", "abc").ok).toBe(false);
  });

  it("ignores days on an immediate trigger rather than storing a meaningless number", () => {
    expect(validateOffset("payment.received", "5")).toEqual({ ok: true, offsetDays: null });
  });
});

describe("describeTrigger", () => {
  it("reads as a sentence", () => {
    expect(describeTrigger("invoice.due_soon", 3)).toBe("3 days before an invoice falls due");
    expect(describeTrigger("invoice.overdue", 1)).toBe("1 day after an invoice falls due, if still unpaid");
    expect(describeTrigger("library.overdue", 5)).toBe("A library book is 5 days overdue");
    expect(describeTrigger("payment.received", null)).toBe("A payment is received");
  });

  it("gives a rule saved before offsets existed its default", () => {
    expect(effectiveOffset("library.overdue", null)).toBe(3);
    expect(describeTrigger("library.overdue", null)).toBe("A library book is 3 days overdue");
  });
});

describe("scheduled kinds", () => {
  it("are recognised, and each offers fields", () => {
    for (const kind of SCHEDULED_EVENT_KINDS) {
      expect(isScheduledKind(kind)).toBe(true);
      expect(EVENT_FIELDS[kind].length).toBeGreaterThan(0);
    }
    expect(isScheduledKind("payment.received")).toBe(false);
  });
});
