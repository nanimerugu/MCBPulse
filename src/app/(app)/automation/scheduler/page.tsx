import { withBranch } from "@/lib/branch-context";
import { heldPermissionKeys } from "@/lib/rbac";
import { formatWallClock } from "@/lib/time-zone";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadAutomationAccess, param } from "@/modules/sis/access";
import { branchTimeZone } from "@/modules/connect/quiet-hours";
import { schedulerOverview } from "@/modules/scheduler/runner.service";
import { describeInterval, heartbeat, humanizeCountKey } from "@/modules/scheduler/schedule";
import { runJobNowAction } from "@/app/(app)/automation/scheduler/actions";

function Counts({ summary }: { summary: unknown }) {
  const entries = Object.entries((summary ?? {}) as Record<string, number>).filter(([, v]) => typeof v === "number" && v > 0);
  if (entries.length === 0) return <span className="text-zinc-400 dark:text-zinc-500">nothing was due</span>;
  return <>{entries.map(([k, v]) => `${v} ${humanizeCountKey(k)}`).join(" · ")}</>;
}

const STATUS_TONE = { RUNNING: "blue", SUCCEEDED: "green", FAILED: "red" } as const;

export default async function SchedulerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadAutomationAccess(param(sp, "branch"), "automation.rules", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Scheduler" />
        <AccessDenied result={result} permission="automation.rules:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const now = new Date();
  const [overview, held, tz] = await Promise.all([
    schedulerOverview(ctx.organizationId),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
    branchTimeZone(ctx.branch.id),
  ]);
  const canRun = held.has("automation.rules:configure");
  const beat = heartbeat(overview.lastTickAt, now);
  const at = (d: Date) => formatWallClock(d, tz);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Scheduler"
        description={`The background jobs that act on time passing. Times on the ${ctx.branch.name} clock (${tz}).`}
        actions={<LinkButton href={withBranch("/automation", ctx)}>← Automation</LinkButton>}
      />

      {beat === "never" ? (
        <div role="status" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">The scheduler has never run on this installation.</p>
          <p className="mt-1">
            Nothing time-based happens until something calls <span className="font-mono">/api/cron/tick</span> — held messages stay held and
            date-based reminders never go. Whoever runs the servers needs to set it up (the operations runbook says how). Until then you can run a
            job for this school by hand below.
          </p>
        </div>
      ) : beat === "late" ? (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <p className="font-medium">The scheduler has stopped — it last ran at {overview.lastTickAt ? at(overview.lastTickAt) : "an unknown time"}.</p>
          <p className="mt-1">Held messages and reminders are waiting. Tell whoever runs the servers.</p>
        </div>
      ) : (
        <div role="status" className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          Running — last tick at {overview.lastTickAt ? at(overview.lastTickAt) : "—"}.
        </div>
      )}

      <Card title="Jobs">
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {overview.jobs.map(({ job, lastScheduled, lastManual }) => (
            <li key={job.key} className="flex flex-col gap-2 py-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">
                    {job.name} <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">· {describeInterval(job.intervalMinutes)}</span>
                  </p>
                  <p className="mt-0.5 text-zinc-600 dark:text-zinc-300">{job.description}</p>
                </div>
                {canRun ? (
                  <ActionForm
                    action={runJobNowAction.bind(null, job.key)}
                    hidden={{ branchId: ctx.branch.id }}
                    submitLabel="Run now for this school"
                    pendingLabel="Running…"
                    inline
                  />
                ) : null}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Platform:{" "}
                {lastScheduled ? (
                  <>
                    <Badge tone={STATUS_TONE[lastScheduled.status]}>{lastScheduled.status.toLowerCase()}</Badge> {at(lastScheduled.startedAt)}
                  </>
                ) : (
                  "never run"
                )}
                {lastManual ? (
                  <>
                    {" · "}This school, by hand: <Badge tone={STATUS_TONE[lastManual.status]}>{lastManual.status.toLowerCase()}</Badge>{" "}
                    {at(lastManual.startedAt)} — {lastManual.status === "FAILED" ? lastManual.error : <Counts summary={lastManual.summary} />}
                  </>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Every job is safe to run twice: a held message is claimed before it is sent, and a date-based rule records each invoice or loan it has
          acted on before it acts. Running a job by hand never sends anything early — it only does what is already due.
        </p>
      </Card>

      <Card title="Runs for this school">
        {overview.recent.length === 0 ? (
          <EmptyState>No job has been run by hand for this school yet. Platform runs cover every school and aren&apos;t itemised here.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="py-2 pr-3 font-medium">Started</th>
                  <th className="py-2 pr-3 font-medium">Job</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {overview.recent.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap py-2 pr-3">{at(r.startedAt)}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.jobKey}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={STATUS_TONE[r.status]}>{r.status.toLowerCase()}</Badge>
                    </td>
                    <td className="py-2 text-xs text-zinc-600 dark:text-zinc-300">{r.status === "FAILED" ? r.error : <Counts summary={r.summary} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
