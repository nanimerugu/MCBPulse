/**
 * Rule evaluation for the automation engine (blueprint §12).
 *
 * WHAT THIS IS AND ISN'T. §12 warns "do not build each module's approvals
 * and notifications separately", and this codebase did exactly that:
 * student leave, staff leave, refunds, admissions decisions, payroll runs
 * and report cards each carry their own approval. This engine does NOT
 * retrofit those — rewriting six working approval flows to go through a
 * generic engine would risk every one of them to gain uniformity nobody has
 * asked for yet. What it adds is the half that genuinely does not exist:
 * TRIGGER → CONDITIONS → ACTION, so a school can say "when a payment is
 * received, text the family" without anyone writing code.
 *
 * Two kinds of trigger:
 *   - IMMEDIATE: something happened ("a payment is received"). The module
 *     that did it calls `emit()` once, after committing.
 *   - SCHEDULED: a date came round ("3 days before an invoice falls due").
 *     Nothing happens at that moment for a module to emit, so the scheduler
 *     looks for them every hour (src/modules/automation/scheduled.service.ts).
 *
 * The honest boundary is in the README, and the engine's page says the same.
 */

export type ImmediateEventKind = "student.enrolled" | "invoice.raised" | "payment.received" | "attendance.absent" | "leave.approved" | "clinic.visit";

export type ScheduledEventKind = "invoice.due_soon" | "invoice.overdue" | "library.overdue";

export type EventKind = ImmediateEventKind | ScheduledEventKind;

export const IMMEDIATE_EVENT_KINDS: ImmediateEventKind[] = [
  "student.enrolled",
  "invoice.raised",
  "payment.received",
  "attendance.absent",
  "leave.approved",
  "clinic.visit",
];

export const SCHEDULED_EVENT_KINDS: ScheduledEventKind[] = ["invoice.due_soon", "invoice.overdue", "library.overdue"];

export const EVENT_KINDS: EventKind[] = [...IMMEDIATE_EVENT_KINDS, ...SCHEDULED_EVENT_KINDS];

export function isScheduledKind(kind: string): kind is ScheduledEventKind {
  return (SCHEDULED_EVENT_KINDS as string[]).includes(kind);
}

export const EVENT_LABELS: Record<EventKind, string> = {
  "student.enrolled": "A student is enrolled",
  "invoice.raised": "An invoice is raised",
  "payment.received": "A payment is received",
  "attendance.absent": "A student is marked absent",
  "leave.approved": "Leave is approved",
  "clinic.visit": "A student visits the infirmary",
  "invoice.due_soon": "Days before an invoice falls due",
  "invoice.overdue": "Days after an invoice falls due, still unpaid",
  "library.overdue": "Days a library book is overdue",
};

/**
 * The facts an event carries. Deliberately a flat, string-and-number bag
 * rather than the whole record: a rule must not be able to reach fields the
 * rule's author was never shown, and a flat shape is one a non-programmer
 * can actually reason about in a dropdown.
 */
export type EventFacts = Record<string, string | number | boolean | null>;

export type Operator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains";

export const OPERATORS: Operator[] = ["eq", "ne", "gt", "gte", "lt", "lte", "contains"];

export const OPERATOR_LABELS: Record<Operator, string> = {
  eq: "is",
  ne: "is not",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  contains: "contains",
};

export interface Condition {
  field: string;
  operator: Operator;
  value: string;
}

/**
 * A single condition against the facts.
 *
 * Comparison is numeric when BOTH sides parse as numbers, and string
 * otherwise. That matters: `"9" > "10"` is true as strings and false as
 * numbers, and an amount rule that fires on the wrong invoices is worse
 * than one that never fires.
 */
export function evaluateCondition(condition: Condition, facts: EventFacts): boolean {
  const actual = facts[condition.field];
  if (actual === undefined || actual === null) return false;

  const actualNum = typeof actual === "number" ? actual : Number(actual);
  const expectedNum = Number(condition.value);
  const numeric = Number.isFinite(actualNum) && Number.isFinite(expectedNum) && condition.value.trim() !== "";

  switch (condition.operator) {
    case "eq":
      return numeric ? actualNum === expectedNum : String(actual).toLowerCase() === condition.value.toLowerCase();
    case "ne":
      return numeric ? actualNum !== expectedNum : String(actual).toLowerCase() !== condition.value.toLowerCase();
    case "gt":
      return numeric && actualNum > expectedNum;
    case "gte":
      return numeric && actualNum >= expectedNum;
    case "lt":
      return numeric && actualNum < expectedNum;
    case "lte":
      return numeric && actualNum <= expectedNum;
    case "contains":
      return String(actual).toLowerCase().includes(condition.value.toLowerCase());
  }
}

/** ALL conditions must hold. A rule with no conditions always fires. */
export function matches(conditions: readonly Condition[], facts: EventFacts): boolean {
  return conditions.every((c) => evaluateCondition(c, facts));
}

/** The facts each event kind provides, so the UI can offer them rather than a free-text box. */
export const EVENT_FIELDS: Record<EventKind, string[]> = {
  "student.enrolled": ["student.name", "student.grade", "student.section", "student.admissionNumber"],
  "invoice.raised": ["invoice.number", "invoice.amount", "student.name", "student.grade"],
  "payment.received": ["payment.amount", "payment.method", "invoice.number", "student.name"],
  "attendance.absent": ["student.name", "student.grade", "student.section", "attendance.date"],
  "leave.approved": ["student.name", "leave.days", "leave.reason"],
  "clinic.visit": ["student.name", "clinic.outcome", "clinic.complaint"],
  "invoice.due_soon": ["invoice.number", "invoice.outstanding", "invoice.dueDate", "student.name", "student.grade", "days"],
  "invoice.overdue": ["invoice.number", "invoice.outstanding", "invoice.dueDate", "student.name", "student.grade", "days"],
  "library.overdue": ["book.title", "borrower.name", "borrower.kind", "loan.dueDate", "loan.daysOverdue"],
};

/**
 * Substitutes {{fact}} placeholders in a message body. Unknown placeholders
 * are left visible rather than blanked, so a broken rule looks broken
 * instead of quietly sending "Dear , your child ".
 */
export function renderMessage(body: string, facts: EventFacts): { text: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const text = body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) => {
    const value = facts[key];
    if (value === undefined || value === null) {
      unresolved.push(key);
      return whole;
    }
    return String(value);
  });
  return { text, unresolved };
}

export function fieldsFor(kind: string): string[] {
  return EVENT_FIELDS[kind as EventKind] ?? [];
}

// --- Date-based triggers ------------------------------------------------------

export const OFFSET_LIMITS: Record<ScheduledEventKind, { min: number; max: number; fallback: number }> = {
  "invoice.due_soon": { min: 1, max: 60, fallback: 3 },
  "invoice.overdue": { min: 1, max: 180, fallback: 7 },
  "library.overdue": { min: 1, max: 90, fallback: 3 },
};

/**
 * How far back a scheduled rule may reach for something it missed.
 *
 * Without a limit, creating "remind families 7 days after the due date"
 * would message every family with a debt from last year the first time the
 * scheduler ran — hundreds of texts, most about invoices the office is
 * already chasing by phone. With it, a rule acts on invoices that crossed
 * its line in the last few days: enough to ride out a scheduler that was
 * down over a weekend, not enough to become a mass mailing.
 */
export const CATCH_UP_DAYS = 3;

/**
 * Does this subject fall inside the rule's window today?
 *
 * `dayDelta` is measured on the school's calendar: days UNTIL the due date
 * for `invoice.due_soon`, days PAST it for the overdue kinds.
 *
 * "Due soon" fires anywhere from N days out to the due date itself, so an
 * invoice raised two days before it is due still gets its reminder (and the
 * `days` fact says 2, not 3). "Overdue" fires from day N to day N+3 only —
 * see CATCH_UP_DAYS for why it must not reach further.
 */
export function scheduledWindowHit(kind: ScheduledEventKind, offsetDays: number, dayDelta: number): boolean {
  if (kind === "invoice.due_soon") return dayDelta >= 0 && dayDelta <= offsetDays;
  return dayDelta >= offsetDays && dayDelta <= offsetDays + CATCH_UP_DAYS;
}

/** Older rules saved before offsets existed get their kind's sensible default. */
export function effectiveOffset(kind: ScheduledEventKind, offsetDays: number | null): number {
  return offsetDays ?? OFFSET_LIMITS[kind].fallback;
}

export type OffsetCheck = { ok: true; offsetDays: number | null } | { ok: false; message: string };

/** A date-based rule needs its number of days; an immediate one must not carry one. */
export function validateOffset(kind: string, raw: string | undefined): OffsetCheck {
  if (!isScheduledKind(kind)) return { ok: true, offsetDays: null };
  const limits = OFFSET_LIMITS[kind];
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { ok: false, message: "Say how many days — this trigger runs on a date" };
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < limits.min || n > limits.max) {
    return { ok: false, message: `Days must be a whole number from ${limits.min} to ${limits.max}` };
  }
  return { ok: true, offsetDays: n };
}

const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** The trigger as a sentence, for the rule list. */
export function describeTrigger(kind: string, offsetDays: number | null): string {
  switch (kind) {
    case "invoice.due_soon":
      return `${plural(effectiveOffset(kind, offsetDays))} before an invoice falls due`;
    case "invoice.overdue":
      return `${plural(effectiveOffset(kind, offsetDays))} after an invoice falls due, if still unpaid`;
    case "library.overdue":
      return `A library book is ${plural(effectiveOffset(kind, offsetDays))} overdue`;
    default:
      return EVENT_LABELS[kind as EventKind] ?? kind;
  }
}
