import { describe, expect, it } from "vitest";
import { checkAdmits, isFull, occupancyPercent, occupancyTone, placesFree } from "@/modules/operations/capacity";

describe("placesFree / isFull", () => {
  it("reports free places and fullness", () => {
    expect(placesFree({ capacity: 4, occupied: 3 })).toBe(1);
    expect(isFull({ capacity: 4, occupied: 3 })).toBe(false);
    expect(isFull({ capacity: 4, occupied: 4 })).toBe(true);
  });

  it("never reports negative free places when over-occupied", () => {
    // Over-occupancy can exist from older data; it must not read as "5 free".
    expect(placesFree({ capacity: 4, occupied: 9 })).toBe(0);
    expect(isFull({ capacity: 4, occupied: 9 })).toBe(true);
  });
});

describe("occupancyPercent", () => {
  it("rounds to whole percent", () => {
    expect(occupancyPercent({ capacity: 3, occupied: 1 })).toBe(33);
    expect(occupancyPercent({ capacity: 4, occupied: 2 })).toBe(50);
  });

  it("treats zero capacity as full rather than dividing by zero", () => {
    expect(occupancyPercent({ capacity: 0, occupied: 0 })).toBe(100);
    expect(Number.isFinite(occupancyPercent({ capacity: 0, occupied: 5 }))).toBe(true);
  });

  it("clamps above 100", () => {
    expect(occupancyPercent({ capacity: 2, occupied: 5 })).toBe(100);
  });
});

describe("checkAdmits", () => {
  it("admits while a place is free", () => {
    expect(checkAdmits({ capacity: 4, occupied: 3 }, "Room 101")).toEqual({ ok: true });
  });

  it("refuses the place that would go over, and says how full it is", () => {
    const r = checkAdmits({ capacity: 4, occupied: 4 }, "Room 101");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("Room 101");
      expect(r.message).toContain("4 of 4");
    }
  });

  it("refuses an unset capacity instead of admitting everyone", () => {
    const r = checkAdmits({ capacity: 0, occupied: 0 }, "Bus 7");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/no capacity/);
  });

  it("handles admitting several at once", () => {
    expect(checkAdmits({ capacity: 10, occupied: 8 }, "Bus 7", 2).ok).toBe(true);
    expect(checkAdmits({ capacity: 10, occupied: 8 }, "Bus 7", 3).ok).toBe(false);
  });
});

describe("occupancyTone", () => {
  it("warns before full and reds out at full", () => {
    expect(occupancyTone({ capacity: 10, occupied: 5 })).toBe("green");
    expect(occupancyTone({ capacity: 10, occupied: 8 })).toBe("amber");
    expect(occupancyTone({ capacity: 10, occupied: 10 })).toBe("red");
  });
});
