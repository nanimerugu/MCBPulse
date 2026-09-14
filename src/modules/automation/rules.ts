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
 * The honest boundary is in the README, and the engine's page says the same.
 */

export type EventKind =
  | "student.enrolled"
  | "invoice.raised"
  | "payment.received"
  | "attendance.absent"
  | "leave.approved"
  | "clinic.visit"
  | "library.overdue";

export const EVENT_KINDS: EventKind[] = [
  "student.enrolled",
  "invoice.raised",
  "payment.received",
  "attendance.absent",
  "leave.approved",
  "clinic.visit",
  "library.overdue",
];

export const EVENT_LABELS: Record<EventKind, string> = {
  "student.enrolled": "A student is enrolled",
  "invoice.raised": "An invoice is raised",
  "payment.received": "A payment is received",
  "attendance.absent": "A student is marked absent",
  "leave.approved": "Leave is approved",
  "clinic.visit": "A student visits the infirmary",
  "library.overdue": "A library book becomes overdue",
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
  "library.overdue": ["book.title", "borrower.name", "loan.daysOverdue"],
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
