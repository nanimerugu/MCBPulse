import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { JOBS, jobByKey, type JobDefinition } from "@/modules/scheduler/jobs";
import { isJobDue, LEASE_MS, sanitizeSummary } from "@/modules/scheduler/schedule";
import { SisError } from "@/modules/sis/students.service";

export type JobOutcomeStatus = "not_due" | "busy" | "succeeded" | "failed";

export interface JobOutcome {
  key: string;
  status: JobOutcomeStatus;
  summary?: Record<string, number>;
  error?: string;
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * Take the job's lease, or report that someone else holds it.
 *
 * The UPDATE only matches a lease that has expired, and the CREATE only
 * succeeds for a job that has never been leased; of two runners arriving
 * together exactly one gets a row back. Same pattern as the library's last
 * copy and the canteen's last rupee: a conditional write, never
 * read-then-write.
 */
async function acquireLease(jobKey: string, holder: string, now: Date): Promise<boolean> {
  const leasedUntil = new Date(now.getTime() + LEASE_MS);
  const taken = await db.jobLease.updateMany({ where: { jobKey, leasedUntil: { lt: now } }, data: { holder, leasedUntil } });
  if (taken.count === 1) return true;
  try {
    await db.jobLease.create({ data: { jobKey, holder, leasedUntil } });
    return true;
  } catch (e) {
    if (isUniqueViolation(e)) return false;
    throw e;
  }
}

async function releaseLease(jobKey: string, holder: string): Promise<void> {
  // Only our own lease: if it expired and someone else took it, it's theirs.
  await db.jobLease.updateMany({ where: { jobKey, holder }, data: { leasedUntil: new Date(0) } });
}

async function runJob(
  job: JobDefinition,
  opts: { trigger: "SCHEDULE" | "MANUAL"; organizationId: string | null; userId: string | null; now: Date },
): Promise<JobOutcome> {
  const holder = randomUUID();
  if (!(await acquireLease(job.key, holder, opts.now))) return { key: job.key, status: "busy" };

  try {
    // We hold the lease, so any RUNNING row for this job belongs to a runner
    // that died without finishing. Close it rather than let the page claim
    // the job has been "running" since last Tuesday.
    await db.jobRun.updateMany({
      where: { jobKey: job.key, status: "RUNNING", startedAt: { lt: opts.now } },
      data: { status: "FAILED", error: "Abandoned — the runner stopped before finishing", finishedAt: opts.now },
    });

    const run = await db.jobRun.create({
      data: { jobKey: job.key, trigger: opts.trigger, organizationId: opts.organizationId, triggeredByUserId: opts.userId, startedAt: opts.now },
    });

    try {
      const summary = sanitizeSummary(await job.run({ now: opts.now, organizationId: opts.organizationId }));
      await db.jobRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", summary, finishedAt: new Date() } });
      return { key: job.key, status: "succeeded", summary };
    } catch (e) {
      const error = (e instanceof Error ? e.message : "Unknown error").slice(0, 500);
      console.error(`[scheduler] ${job.key} failed`, e);
      await db.jobRun.update({ where: { id: run.id }, data: { status: "FAILED", error, finishedAt: new Date() } });
      return { key: job.key, status: "failed", error };
    }
  } finally {
    await releaseLease(job.key, holder);
  }
}

/** One platform tick: run every job whose interval has passed, for every organization. */
export async function runDueJobs(now = new Date()): Promise<JobOutcome[]> {
  const outcomes: JobOutcome[] = [];
  for (const job of JOBS) {
    const last = await db.jobRun.findFirst({
      where: { jobKey: job.key, organizationId: null, trigger: "SCHEDULE" },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    });
    if (!isJobDue(last?.startedAt ?? null, job.intervalMinutes, now)) {
      outcomes.push({ key: job.key, status: "not_due" });
      continue;
    }
    outcomes.push(await runJob(job, { trigger: "SCHEDULE", organizationId: null, userId: null, now }));
  }
  return outcomes;
}

/**
 * An administrator's "Run now". Confined to their own organization, so it
 * can't send another school's reminders — and audited, because it can send
 * this school's.
 */
export async function runJobForOrganization(jobKey: string, organizationId: string, userId: string): Promise<JobOutcome> {
  const job = jobByKey(jobKey);
  if (!job) throw new SisError("Unknown job");
  const outcome = await runJob(job, { trigger: "MANUAL", organizationId, userId, now: new Date() });
  await recordAuditEvent({
    organizationId,
    actorUserId: userId,
    action: "scheduler.job_run_manually",
    resourceType: "job",
    resourceId: jobKey,
    after: { status: outcome.status, ...(outcome.summary ?? {}) },
  });
  return outcome;
}

export async function schedulerOverview(organizationId: string) {
  const [lastTick, jobs, recent] = await Promise.all([
    db.jobRun.findFirst({ where: { trigger: "SCHEDULE", organizationId: null }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    Promise.all(
      JOBS.map(async (job) => {
        const [lastScheduled, lastManual] = await Promise.all([
          // The platform run's status and time are shown; its summary is NOT —
          // those counts cover every school on the platform.
          db.jobRun.findFirst({
            where: { jobKey: job.key, organizationId: null, trigger: "SCHEDULE" },
            orderBy: { startedAt: "desc" },
            select: { status: true, startedAt: true, finishedAt: true, error: true },
          }),
          db.jobRun.findFirst({ where: { jobKey: job.key, organizationId }, orderBy: { startedAt: "desc" } }),
        ]);
        return { job, lastScheduled, lastManual };
      }),
    ),
    db.jobRun.findMany({ where: { organizationId }, orderBy: { startedAt: "desc" }, take: 15 }),
  ]);
  return { lastTickAt: lastTick?.startedAt ?? null, jobs, recent };
}
