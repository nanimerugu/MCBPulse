import "server-only";
import { evaluateDateRules } from "@/modules/automation/scheduled.service";
import { deliverHeldMessages, sendDueBroadcasts } from "@/modules/connect/deferred.service";

/**
 * Every background job the platform runs.
 *
 * A job must be SAFE TO RUN TWICE: a tick can be retried by the platform,
 * two instances can both receive one, and an administrator can press "Run
 * now" in the middle of a scheduled run. The lease makes overlap rare; each
 * job's own claim-before-act makes it harmless.
 *
 * `organizationId` is null for the platform tick (every organization) and
 * set for an administrator's manual run, which must never reach another
 * school's records.
 */

export interface JobContext {
  now: Date;
  organizationId: string | null;
}

export interface JobDefinition {
  key: string;
  name: string;
  description: string;
  intervalMinutes: number;
  /** Returns counts for the run history. Never names, numbers or text. */
  run(ctx: JobContext): Promise<Record<string, number>>;
}

export const JOBS: readonly JobDefinition[] = [
  {
    key: "connect.deferred_delivery",
    name: "Deliver held messages",
    description:
      "Sends messages that quiet hours held back once the window closes, and broadcasts whose scheduled time has arrived. Without it, anything held for the morning would wait forever.",
    intervalMinutes: 5,
    async run({ now, organizationId }) {
      const messages = await deliverHeldMessages(now, organizationId);
      const broadcasts = await sendDueBroadcasts(now, organizationId);
      return { ...messages, ...broadcasts };
    },
  },
  {
    key: "automation.date_rules",
    name: "Date-based automation rules",
    description:
      "Checks invoice due dates and library loans against every active date-based rule, and acts on each invoice or loan at most once per rule.",
    intervalMinutes: 60,
    run: ({ now, organizationId }) => evaluateDateRules(now, organizationId),
  },
];

export function jobByKey(key: string): JobDefinition | undefined {
  return JOBS.find((j) => j.key === key);
}
