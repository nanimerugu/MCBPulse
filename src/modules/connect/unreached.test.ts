import { describe, expect, it } from "vitest";
import { unreachedWarning, type GuardianNotifyOutcome } from "@/modules/connect/delivery-policy";

const base: GuardianNotifyOutcome = { queued: 0, sent: 0, suppressed: [], guardiansOnRecord: 0 };

/**
 * The distinction these tests protect: "recorded" is not "the family knows".
 * A nurse sending a feverish child home must never be left believing a
 * parent was told when every route to them was suppressed.
 */
describe("unreachedWarning", () => {
  it("says nothing when at least one guardian was contacted", () => {
    expect(unreachedWarning({ ...base, queued: 1, sent: 1, guardiansOnRecord: 1 })).toBeNull();
  });

  it("still says nothing when the message queued but has not sent yet", () => {
    // Queued counts as reached: it is in the delivery log and will go out.
    expect(unreachedWarning({ ...base, queued: 1, sent: 0, guardiansOnRecord: 1 })).toBeNull();
  });

  it("names the opted-out guardian and tells the user to phone", () => {
    const w = unreachedWarning({
      ...base,
      guardiansOnRecord: 1,
      suppressed: [{ name: "Anil Rao", reason: "Opted out of this channel" }],
    });
    expect(w).toContain("Anil Rao");
    expect(w).toContain("opted out");
    expect(w).toMatch(/Telephone them/);
  });

  it("lists every guardian when several were suppressed", () => {
    const w = unreachedWarning({
      ...base,
      guardiansOnRecord: 2,
      suppressed: [
        { name: "Anil Rao", reason: "Opted out of this channel" },
        { name: "Sunita Rao", reason: "No address on file" },
      ],
    });
    expect(w).toContain("Anil Rao");
    expect(w).toContain("Sunita Rao");
  });

  it("distinguishes a student with no guardian on record at all", () => {
    const w = unreachedWarning({ ...base, guardiansOnRecord: 0 });
    expect(w).toMatch(/no guardian linked/i);
  });

  it("distinguishes the module being switched off from a suppression", () => {
    const w = unreachedWarning({ ...base, moduleOff: true });
    expect(w).toMatch(/switched off/i);
  });

  it("distinguishes an outright failure, and still says to phone", () => {
    const w = unreachedWarning({ ...base, failed: true });
    expect(w).toMatch(/errored/i);
    expect(w).toMatch(/Telephone them/);
  });
});
