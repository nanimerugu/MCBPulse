import { describe, expect, it } from "vitest";
import { evaluateCondition, EVENT_FIELDS, EVENT_KINDS, matches, renderMessage } from "@/modules/automation/rules";

const facts = { "payment.amount": 5000, "payment.method": "CASH", "student.name": "Priya Rao", "student.grade": "Grade 5" };

describe("evaluateCondition", () => {
  it("compares numbers numerically, not as strings", () => {
    // "9" > "10" is true as strings and false as numbers. An amount rule
    // firing on the wrong invoices is worse than one that never fires.
    expect(evaluateCondition({ field: "payment.amount", operator: "gt", value: "900" }, { "payment.amount": 1000 })).toBe(true);
    expect(evaluateCondition({ field: "payment.amount", operator: "gt", value: "10000" }, { "payment.amount": 9000 })).toBe(false);
  });

  it("compares strings case-insensitively for eq", () => {
    expect(evaluateCondition({ field: "payment.method", operator: "eq", value: "cash" }, facts)).toBe(true);
    expect(evaluateCondition({ field: "payment.method", operator: "eq", value: "cheque" }, facts)).toBe(false);
  });

  it("handles ne, gte, lte and lt", () => {
    expect(evaluateCondition({ field: "payment.method", operator: "ne", value: "cheque" }, facts)).toBe(true);
    expect(evaluateCondition({ field: "payment.amount", operator: "gte", value: "5000" }, facts)).toBe(true);
    expect(evaluateCondition({ field: "payment.amount", operator: "lte", value: "5000" }, facts)).toBe(true);
    expect(evaluateCondition({ field: "payment.amount", operator: "lt", value: "5000" }, facts)).toBe(false);
  });

  it("supports contains for partial text", () => {
    expect(evaluateCondition({ field: "student.grade", operator: "contains", value: "grade" }, facts)).toBe(true);
    expect(evaluateCondition({ field: "student.name", operator: "contains", value: "rao" }, facts)).toBe(true);
  });

  it("is false — never true — for a fact that isn't there", () => {
    // A rule must not fire because a field is missing.
    expect(evaluateCondition({ field: "nope", operator: "eq", value: "anything" }, facts)).toBe(false);
    expect(evaluateCondition({ field: "nope", operator: "ne", value: "anything" }, facts)).toBe(false);
    expect(evaluateCondition({ field: "x", operator: "eq", value: "y" }, { x: null })).toBe(false);
  });

  it("refuses an ordering comparison against non-numeric text", () => {
    expect(evaluateCondition({ field: "student.name", operator: "gt", value: "A" }, facts)).toBe(false);
  });
});

describe("matches", () => {
  it("requires every condition to hold", () => {
    expect(matches([{ field: "payment.method", operator: "eq", value: "CASH" }, { field: "payment.amount", operator: "gte", value: "1000" }], facts)).toBe(true);
    expect(matches([{ field: "payment.method", operator: "eq", value: "CASH" }, { field: "payment.amount", operator: "gte", value: "9000" }], facts)).toBe(false);
  });

  it("fires unconditionally when there are no conditions", () => {
    expect(matches([], facts)).toBe(true);
  });
});

describe("renderMessage", () => {
  it("substitutes facts", () => {
    const r = renderMessage("We received {{payment.amount}} for {{student.name}}.", facts);
    expect(r.text).toBe("We received 5000 for Priya Rao.");
    expect(r.unresolved).toEqual([]);
  });

  it("LEAVES an unknown placeholder visible rather than blanking it", () => {
    // A broken rule should look broken, not quietly send "Dear , your child".
    const r = renderMessage("Dear {{guardian.name}}, about {{student.name}}", facts);
    expect(r.text).toContain("{{guardian.name}}");
    expect(r.unresolved).toEqual(["guardian.name"]);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderMessage("{{ student.name }}", facts).text).toBe("Priya Rao");
  });

  it("leaves text with no placeholders alone", () => {
    expect(renderMessage("School is closed tomorrow.", facts).text).toBe("School is closed tomorrow.");
  });
});

describe("EVENT_FIELDS", () => {
  it("covers every event kind, so the UI can always offer fields", () => {
    for (const kind of EVENT_KINDS) {
      expect(EVENT_FIELDS[kind], kind).toBeDefined();
      expect(EVENT_FIELDS[kind].length).toBeGreaterThan(0);
    }
  });
});
