import { describe, expect, it } from "vitest";
import { normalizePhone, phoneMatchFilter } from "@/lib/phone";

describe("phoneMatchFilter", () => {
  it("matches on the full normalized number, so 9000000003 and 9100000003 stay distinct", () => {
    const f = phoneMatchFilter("9100000003");
    expect(f).toEqual({ endsWith: "9100000003" });
    // The bug this guards against: a last-8-digit match would have paired these.
    expect("9000000003".endsWith((f as { endsWith: string }).endsWith)).toBe(false);
    expect("+91 9100000003".endsWith((f as { endsWith: string }).endsWith)).toBe(true);
  });

  it("uses exact equality for short numbers rather than a risky suffix", () => {
    expect(phoneMatchFilter("1234567")).toEqual({ equals: "1234567" });
  });

  it("refuses implausible input", () => {
    expect(phoneMatchFilter("12")).toBeNull();
    expect(phoneMatchFilter("call me")).toBeNull();
  });

  it("agrees with normalizePhone on formatting", () => {
    expect(phoneMatchFilter("+91 90000 00001")).toEqual({ endsWith: normalizePhone("9000000001") });
  });
});
