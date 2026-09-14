import { describe, expect, it } from "vitest";
import {
  ACTIONS_CLEARING_SECTION,
  ACTIONS_REQUIRING_SECTION,
  LIFECYCLE_ACTIONS,
  allowedActions,
  nextStatus,
} from "@/modules/sis/lifecycle";

describe("student lifecycle state machine", () => {
  it("enrolls an enquiry or applicant, and nothing else can be 'enrolled'", () => {
    expect(nextStatus("ENQUIRY", "enroll")).toBe("ENROLLED");
    expect(nextStatus("APPLIED", "enroll")).toBe("ENROLLED");
    expect(nextStatus("ENROLLED", "enroll")).toBeNull();
    expect(nextStatus("WITHDRAWN", "enroll")).toBeNull(); // must use reenroll
    expect(nextStatus("ALUMNI", "enroll")).toBeNull();
  });

  it("promotion keeps the student enrolled (it's a section change)", () => {
    expect(nextStatus("ENROLLED", "promote")).toBe("ENROLLED");
    expect(nextStatus("ENQUIRY", "promote")).toBeNull();
  });

  it("alumni is terminal", () => {
    expect(allowedActions("ALUMNI")).toEqual([]);
    for (const action of LIFECYCLE_ACTIONS) {
      expect(nextStatus("ALUMNI", action)).toBeNull();
    }
  });

  it("withdrawn and transferred students can only come back via reenroll", () => {
    expect(allowedActions("WITHDRAWN")).toEqual(["reenroll"]);
    expect(allowedActions("TRANSFERRED")).toEqual(["reenroll"]);
    expect(nextStatus("WITHDRAWN", "reenroll")).toBe("ENROLLED");
  });

  it("only enrolled students can graduate, transfer or be promoted", () => {
    expect(allowedActions("ENROLLED").sort()).toEqual(["graduate", "promote", "transfer", "withdraw"].sort());
    expect(nextStatus("APPLIED", "graduate")).toBeNull();
  });

  it("every action either needs a section or clears one — never both, never neither", () => {
    for (const action of LIFECYCLE_ACTIONS) {
      const needs = ACTIONS_REQUIRING_SECTION.has(action);
      const clears = ACTIONS_CLEARING_SECTION.has(action);
      expect(needs !== clears).toBe(true);
    }
  });
});
