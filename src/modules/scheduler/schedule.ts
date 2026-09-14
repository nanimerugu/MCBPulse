/**
 * When a background job should run, decided without a database.
 *
 * The scheduler is a tick, not a daemon: something outside the app (a
 * platform cron, a systemd timer, `npm run scheduler` on a VM) calls
 * `/api/cron/tick` every minute or so, and each tick runs whichever jobs are
 * due. That shape was chosen because it survives every way this app can be
 * deployed — serverless functions can't hold a timer, and a timer inside a
 * web process runs once per instance, which for "text every family whose fee
 * is due" is exactly the wrong number of times.
 *
 * Correctness never depends on the tick being punctual or unique. Jobs are
 * idempotent (see the dedupe key on AutomationRun and the claim on deferred
 * messages), and a lease stops two ticks running the same job at once.
 */

/** How long a runner may hold a job before another may assume it crashed. */
export const LEASE_MS = 10 * 60_000;

/** A job is due when it has never run, or its interval has passed since it last STARTED. */
export function isJobDue(lastStartedAt: Date | null, intervalMinutes: number, now: Date): boolean {
  if (!lastStartedAt) return true;
  return now.getTime() - lastStartedAt.getTime() >= intervalMinutes * 60_000;
}

/**
 * A RUNNING row older than the lease belongs to a runner that died mid-job
 * (a deploy, an OOM). Left alone it would read as "still running" forever.
 */
export function isAbandoned(run: { status: string; startedAt: Date }, now: Date): boolean {
  return run.status === "RUNNING" && now.getTime() - run.startedAt.getTime() > LEASE_MS;
}

export function describeInterval(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? "daily" : `every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "hourly" : `every ${minutes / 60} hours`;
  return minutes === 1 ? "every minute" : `every ${minutes} minutes`;
}

/**
 * Is the scheduler actually being driven? A page that lists jobs but never
 * says "nothing has ticked for two days" would let a school believe fee
 * reminders are going out when the cron was never configured.
 */
export type HeartbeatState = "never" | "healthy" | "late";

export function heartbeat(lastTickAt: Date | null, now: Date, expectedEveryMinutes = 5): HeartbeatState {
  if (!lastTickAt) return "never";
  // Three missed ticks before crying wolf: one slow deploy is not an outage.
  return now.getTime() - lastTickAt.getTime() > expectedEveryMinutes * 3 * 60_000 ? "late" : "healthy";
}

/** Job summaries are counts. Anything else is dropped rather than stored. */
export function sanitizeSummary(summary: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(summary)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** "heldMessagesSent" → "held messages sent", for showing a summary to a person. */
export function humanizeCountKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

/** Sum per-organization summaries into one platform-wide total. */
export function mergeSummaries(parts: readonly Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of parts) for (const [k, v] of Object.entries(part)) out[k] = (out[k] ?? 0) + v;
  return out;
}
