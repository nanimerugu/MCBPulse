import { describe, expect, it } from "vitest";
import { describeInterval, heartbeat, isAbandoned, isJobDue, LEASE_MS, mergeSummaries, sanitizeSummary } from "@/modules/scheduler/schedule";
import { checkCronAuth, MIN_SECRET_LENGTH } from "@/modules/scheduler/cron-auth";

const now = new Date("2026-09-15T10:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("isJobDue", () => {
  it("runs a job that has never run", () => {
    expect(isJobDue(null, 60, now)).toBe(true);
  });

  it("waits out the interval from the last START", () => {
    expect(isJobDue(minutesAgo(59), 60, now)).toBe(false);
    expect(isJobDue(minutesAgo(60), 60, now)).toBe(true);
    expect(isJobDue(minutesAgo(4), 5, now)).toBe(false);
  });
});

describe("isAbandoned", () => {
  it("treats a RUNNING row older than the lease as a crashed runner", () => {
    expect(isAbandoned({ status: "RUNNING", startedAt: new Date(now.getTime() - LEASE_MS - 1) }, now)).toBe(true);
    expect(isAbandoned({ status: "RUNNING", startedAt: minutesAgo(1) }, now)).toBe(false);
  });

  it("never touches a finished run, however old", () => {
    expect(isAbandoned({ status: "SUCCEEDED", startedAt: minutesAgo(10_000) }, now)).toBe(false);
  });
});

describe("heartbeat", () => {
  it("says so plainly when nothing has ever ticked", () => {
    // The page must not list jobs as if they were running when the cron was
    // never set up.
    expect(heartbeat(null, now)).toBe("never");
  });

  it("allows a couple of missed ticks before calling it late", () => {
    expect(heartbeat(minutesAgo(10), now, 5)).toBe("healthy");
    expect(heartbeat(minutesAgo(16), now, 5)).toBe("late");
  });
});

describe("describeInterval", () => {
  it("reads like a person wrote it", () => {
    expect(describeInterval(5)).toBe("every 5 minutes");
    expect(describeInterval(60)).toBe("hourly");
    expect(describeInterval(180)).toBe("every 3 hours");
    expect(describeInterval(1440)).toBe("daily");
  });
});

describe("summaries", () => {
  it("keep counts and drop anything that could carry personal data", () => {
    expect(sanitizeSummary({ sent: 3, failed: 0, firstRecipient: "Anil Rao", nan: Number.NaN })).toEqual({ sent: 3, failed: 0 });
  });

  it("add up across organizations", () => {
    expect(mergeSummaries([{ sent: 2, failed: 1 }, { sent: 3 }, {}])).toEqual({ sent: 5, failed: 1 });
  });
});

describe("checkCronAuth", () => {
  const secret = "s".repeat(MIN_SECRET_LENGTH);

  it("fails closed when no secret is configured", () => {
    expect(checkCronAuth(`Bearer ${secret}`, undefined)).toBe("not_configured");
    expect(checkCronAuth("Bearer ", "")).toBe("not_configured");
  });

  it("refuses a secret too short to be one", () => {
    expect(checkCronAuth("Bearer short", "short")).toBe("not_configured");
  });

  it("accepts only the exact bearer token", () => {
    expect(checkCronAuth(`Bearer ${secret}`, secret)).toBe("ok");
    expect(checkCronAuth(`bearer ${secret}`, secret)).toBe("ok");
    expect(checkCronAuth(`Bearer ${secret}x`, secret)).toBe("unauthorized");
    expect(checkCronAuth(secret, secret)).toBe("unauthorized");
    expect(checkCronAuth(null, secret)).toBe("unauthorized");
  });
});
