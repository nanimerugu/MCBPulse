import { describe, expect, it } from "vitest";
import { extractVariables, render, smsSegments, unknownVariables } from "@/modules/connect/templates";

describe("variable allow-list", () => {
  it("finds placeholders once each, case-insensitively", () => {
    expect(extractVariables("Hi {{student.first_name}}, {{ student.first_name }} again, {{school.name}}")).toEqual([
      "student.first_name",
      "school.name",
    ]);
  });

  it("flags anything not on the allow-list", () => {
    expect(unknownVariables("Hi {{student.first_name}}")).toEqual([]);
    // The whole point: a template must not be able to reach arbitrary data.
    expect(unknownVariables("{{student.medical_notes}} {{user.password_hash}}")).toEqual([
      "student.medical_notes",
      "user.password_hash",
    ]);
  });
});

describe("render", () => {
  it("substitutes allow-listed variables", () => {
    const r = render("Dear {{guardian.name}}, {{student.first_name}} was absent on {{attendance.date}}.", {
      "guardian.name": "Anil Rao",
      "student.first_name": "Priya",
      "attendance.date": "2026-09-14",
    });
    expect(r.text).toBe("Dear Anil Rao, Priya was absent on 2026-09-14.");
    expect(r.missing).toEqual([]);
  });

  it("reports allow-listed variables the context didn't supply, and never prints undefined", () => {
    const r = render("Hi {{guardian.name}}, invoice {{invoice.number}}", { "guardian.name": "Anil Rao" });
    expect(r.text).toBe("Hi Anil Rao, invoice ");
    expect(r.missing).toEqual(["invoice.number"]);
    expect(r.text).not.toMatch(/undefined|null/);
  });

  it("leaves an unknown placeholder verbatim rather than inventing a value", () => {
    const r = render("{{student.medical_notes}}", {});
    expect(r.text).toBe("{{student.medical_notes}}");
    expect(r.missing).toEqual([]);
  });

  it("cannot be used to traverse into an object", () => {
    // A context is a flat map of allow-listed keys; nothing resolves here.
    const r = render("{{student.guardian.phone}} {{constructor}}", {});
    expect(r.text).toBe("{{student.guardian.phone}} {{constructor}}");
  });
});

describe("smsSegments", () => {
  it("counts GSM-7 segments", () => {
    expect(smsSegments("")).toBe(0);
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
    expect(smsSegments("a".repeat(306))).toBe(2);
    expect(smsSegments("a".repeat(307))).toBe(3);
  });

  it("drops to unicode limits when a non-ASCII character appears", () => {
    expect(smsSegments("न".repeat(70))).toBe(1);
    expect(smsSegments("न".repeat(71))).toBe(2);
  });
});
