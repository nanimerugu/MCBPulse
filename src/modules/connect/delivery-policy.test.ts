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

describe("quiet hours on the school's clock", () => {
  const quiet = { start: "21:00", end: "07:00" };
  const IST = "Asia/Kolkata";

  it("reads 21:00–07:00 as India time, not UTC", () => {
    // 16:00 UTC is 21:30 in India: quiet. Read in UTC it wasn't — the bug
    // that texted Indian families at half past nine at night.
    expect(isWithinQuietHours(new Date("2026-09-14T16:00:00Z"), quiet, IST)).toBe(true);
    expect(isWithinQuietHours(new Date("2026-09-14T16:00:00Z"), quiet, "UTC")).toBe(false);
    // 03:00 UTC is 08:30 in India: the school day. UTC called it quiet.
    expect(isWithinQuietHours(new Date("2026-09-15T03:00:00Z"), quiet, IST)).toBe(false);
    expect(isWithinQuietHours(new Date("2026-09-15T03:00:00Z"), quiet, "UTC")).toBe(true);
  });

  it("releases a held message at 07:00 India time", () => {
    // 21:30 IST on the 14th → 07:00 IST on the 15th = 01:30 UTC.
    expect(nextSendableAt(new Date("2026-09-14T16:00:00Z"), quiet, IST).toISOString()).toBe("2026-09-15T01:30:00.000Z");
    // 02:00 IST (20:30 UTC the day before) → the same morning's 07:00.
    expect(nextSendableAt(new Date("2026-09-14T20:30:00Z"), quiet, IST).toISOString()).toBe("2026-09-15T01:30:00.000Z");
  });

  it("rounds to the minute so a held message never lands a few seconds early", () => {
    expect(nextSendableAt(new Date("2026-09-14T22:30:45Z"), quiet).toISOString()).toBe("2026-09-15T07:00:00.000Z");
  });
});
