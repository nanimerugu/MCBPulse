import { describe, expect, it } from "vitest";
import {
  APPLICATION_DECISIONS,
  LEAD_STAGES_OPEN_TO_APPLICATION,
  applicationTransitions,
  canMoveApplication,
  canMoveLead,
  isPlausiblePhone,
  manualLeadTransitions,
  normalizePhone,
} from "@/modules/admissions/pipeline";

describe("lead pipeline", () => {
  it("lets a counselor move a lead forward or mark it lost, but never to APPLIED/ADMITTED by hand", () => {
    expect(manualLeadTransitions("NEW")).toEqual(["CONTACTED", "QUALIFIED", "LOST"]);
    expect(canMoveLead("QUALIFIED", "APPLIED")).toBe(false);
    expect(canMoveLead("APPLIED", "ADMITTED")).toBe(false);
  });

  it("admitted is terminal; lost can be reopened", () => {
    expect(manualLeadTransitions("ADMITTED")).toEqual([]);
    expect(manualLeadTransitions("LOST")).toEqual(["CONTACTED"]);
  });

  it("an application can be opened from any pre-application stage only", () => {
    expect(LEAD_STAGES_OPEN_TO_APPLICATION.has("NEW")).toBe(true);
    expect(LEAD_STAGES_OPEN_TO_APPLICATION.has("QUALIFIED")).toBe(true);
    expect(LEAD_STAGES_OPEN_TO_APPLICATION.has("APPLIED")).toBe(false);
    expect(LEAD_STAGES_OPEN_TO_APPLICATION.has("LOST")).toBe(false);
  });
});

describe("application status machine", () => {
  it("follows documents -> review -> decision", () => {
    expect(applicationTransitions("DOCUMENTS_PENDING")).toEqual(["UNDER_REVIEW", "REJECTED"]);
    expect(applicationTransitions("UNDER_REVIEW")).toEqual(["OFFERED", "WAITLISTED", "REJECTED"]);
    expect(canMoveApplication("WAITLISTED", "OFFERED")).toBe(true);
    expect(canMoveApplication("OFFERED", "ACCEPTED")).toBe(true);
  });

  it("cannot skip review, and accepted/rejected are terminal", () => {
    expect(canMoveApplication("DOCUMENTS_PENDING", "OFFERED")).toBe(false);
    expect(applicationTransitions("ACCEPTED")).toEqual([]);
    expect(applicationTransitions("REJECTED")).toEqual([]);
  });

  it("every decision status requires approval; moving into review does not", () => {
    for (const s of ["OFFERED", "WAITLISTED", "ACCEPTED", "REJECTED"] as const) expect(APPLICATION_DECISIONS.has(s)).toBe(true);
    expect(APPLICATION_DECISIONS.has("UNDER_REVIEW")).toBe(false);
  });
});

describe("phone normalization", () => {
  it("matches the same number typed different ways", () => {
    expect(normalizePhone("+91 90000 00001")).toBe("9000000001");
    expect(normalizePhone("090000-00001")).toBe("09000000001".slice(-10));
    expect(normalizePhone("9000000001")).toBe("9000000001");
    expect(normalizePhone("(900) 000-0001")).toBe("9000000001");
  });

  it("leaves short or very long numbers alone rather than guessing", () => {
    expect(normalizePhone("12345")).toBe("12345");
    expect(normalizePhone("+1 202 555 0100 x123")).toBe("12025550100123");
  });

  it("judges plausibility on digit count", () => {
    expect(isPlausiblePhone("9000000001")).toBe(true);
    expect(isPlausiblePhone("12345")).toBe(false);
    expect(isPlausiblePhone("1234567890123456")).toBe(false);
  });
});
