import { describe, expect, it } from "vitest";
import { redact, restore, totalRedactions } from "@/modules/ai/redaction";

describe("redact", () => {
  it("replaces a phone number, an email and an admission number", () => {
    const r = redact("Call 9000000001 or write to anil@example.com about N-1001.");
    expect(r.text).not.toContain("9000000001");
    expect(r.text).not.toContain("anil@example.com");
    expect(r.text).not.toContain("N-1001");
    expect(r.counts.phone).toBe(1);
    expect(r.counts.email).toBe(1);
    expect(r.counts.admission_number).toBe(1);
  });

  it("replaces known names, longest first, so no fragment is left behind", () => {
    const r = redact("Priya Rao and Rao both need forms.", ["Rao", "Priya Rao"]);
    expect(r.text).not.toContain("Priya Rao");
    // "Priya Rao" must have been consumed as one unit before bare "Rao" ran.
    expect(r.text).toMatch(/\[NAME_1\]/);
  });

  it("is case-insensitive on names", () => {
    const r = redact("meera was absent", ["Meera"]);
    expect(r.text).not.toMatch(/meera/i);
  });

  it("reuses one placeholder for a repeated value", () => {
    const r = redact("Ring 9000000001, and if not, 9000000001 again.");
    expect(r.counts.phone).toBe(1);
    expect(r.text.match(/\[PHONE_1\]/g)).toHaveLength(2);
  });

  it("leaves ordinary text alone", () => {
    const text = "The trip is on Tuesday and costs nothing.";
    const r = redact(text);
    expect(r.text).toBe(text);
    expect(totalRedactions(r.counts)).toBe(0);
  });

  it("ignores blank and one-character names rather than shredding the text", () => {
    const r = redact("A quick note about a trip.", ["", " ", "A"]);
    expect(r.text).toBe("A quick note about a trip.");
  });

  it("round-trips through restore", () => {
    const original = "Priya Rao (N-1001) — call 9000000001 or anil@example.com";
    const r = redact(original, ["Priya Rao"]);
    expect(restore(r.text, r.map)).toBe(original);
  });

  it("restores placeholders inside a model's answer", () => {
    const r = redact("Please chase Priya Rao on 9000000001.", ["Priya Rao"]);
    const answer = `I suggest contacting ${[...r.map.keys()].find((k) => k.startsWith("[NAME"))} first.`;
    expect(restore(answer, r.map)).toContain("Priya Rao");
  });
});
