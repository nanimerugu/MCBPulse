import { describe, expect, it } from "vitest";
import { isWithinQuietHours, nextSendableAt, planDelivery, type Recipient } from "@/modules/connect/delivery-policy";

const base: Omit<Recipient, "key" | "address"> = { name: "Anil Rao", channel: "SMS", optedOut: false };

describe("planDelivery", () => {
  it("sends to everyone contactable", () => {
    const plan = planDelivery([
      { ...base, key: "g1", address: "9000000001" },
      { ...base, key: "g2", address: "9000000002" },
    ]);
    expect(plan.send.map((r) => r.key)).toEqual(["g1", "g2"]);
    expect(plan.suppressed).toEqual([]);
  });

  it("suppresses opt-outs and missing addresses, and says why", () => {
    const plan = planDelivery([
      { ...base, key: "g1", address: "9000000001", optedOut: true },
      { ...base, key: "g2", address: "  " },
      { ...base, key: "g3", address: "9000000003" },
    ]);
    expect(plan.send.map((r) => r.key)).toEqual(["g3"]);
    expect(plan.suppressed.map((s) => [s.recipient.key, s.reason])).toEqual([
      ["g1", "opted_out"],
      ["g2", "no_address"],
    ]);
  });

  it("collapses a guardian who appears twice — two children, one person, one message", () => {
    const plan = planDelivery([
      { ...base, key: "link-priya", address: "9000000001" },
      { ...base, key: "link-rohan", address: "9000000001" },
    ]);
    expect(plan.send).toHaveLength(1);
    expect(plan.suppressed[0].reason).toBe("duplicate");
  });

  it("treats the same address on different channels as different sends", () => {
    const plan = planDelivery([
      { ...base, key: "a", address: "x@example.com", channel: "EMAIL" },
      { ...base, key: "b", address: "x@example.com", channel: "WHATSAPP" },
    ]);
    expect(plan.send).toHaveLength(2);
  });
});

describe("quiet hours", () => {
  const quiet = { start: "21:00", end: "07:00" }; // wraps midnight

  it("covers both sides of midnight", () => {
    expect(isWithinQuietHours(new Date("2026-09-14T21:00:00Z"), quiet)).toBe(true);
    expect(isWithinQuietHours(new Date("2026-09-14T23:30:00Z"), quiet)).toBe(true);
    expect(isWithinQuietHours(new Date("2026-09-15T03:00:00Z"), quiet)).toBe(true);
    expect(isWithinQuietHours(new Date("2026-09-15T06:59:00Z"), quiet)).toBe(true);
    expect(isWithinQuietHours(new Date("2026-09-15T07:00:00Z"), quiet)).toBe(false);
    expect(isWithinQuietHours(new Date("2026-09-14T14:00:00Z"), quiet)).toBe(false);
  });

  it("handles a same-day window too", () => {
    const daytime = { start: "09:00", end: "17:00" };
    expect(isWithinQuietHours(new Date("2026-09-14T12:00:00Z"), daytime)).toBe(true);
    expect(isWithinQuietHours(new Date("2026-09-14T18:00:00Z"), daytime)).toBe(false);
  });

  it("is never quiet when no window is configured", () => {
    expect(isWithinQuietHours(new Date(), null)).toBe(false);
  });

  it("defers a late-evening send to the morning, and an early-hours send to the same morning", () => {
    expect(nextSendableAt(new Date("2026-09-14T22:30:00Z"), quiet).toISOString()).toBe("2026-09-15T07:00:00.000Z");
    expect(nextSendableAt(new Date("2026-09-15T03:00:00Z"), quiet).toISOString()).toBe("2026-09-15T07:00:00.000Z");
  });

  it("leaves a daytime send alone", () => {
    const at = new Date("2026-09-14T14:00:00Z");
    expect(nextSendableAt(at, quiet)).toBe(at);
  });
});
