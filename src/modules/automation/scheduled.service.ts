import "server-only";
import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { daysBetween, isValidTimeZone, localDateISO } from "@/lib/time-zone";
import { AUTOMATION_FLAG } from "@/modules/sis/access";
import { toMinor } from "@/modules/finance/money";
import { paidMinorOf } from "@/modules/finance/invoices.service";
import { performRuleAction } from "@/modules/automation/emit";
import {
  CATCH_UP_DAYS,
  effectiveOffset,
  isScheduledKind,
  matches,
  SCHEDULED_EVENT_KINDS,
  scheduledWindowHit,
  type Condition,
  type EventFacts,
  type ScheduledEventKind,
} from "@/modules/automation/rules";

/**
 * Date-based automation: "3 days before an invoice falls due, text the
 * family". Run hourly by the scheduler (src/modules/scheduler/jobs.ts).
 *
 * ONCE PER SUBJECT, ENFORCED BY THE DATABASE. The same invoice is inside a
 * "due soon" window for several hourly runs in a row, and two runners could
 * overlap after a crash. So before acting, a run row is inserted with a
 * dedupe key of (rule, invoice); the unique index on that key makes the
 * second insert fail, and the second runner moves on. The row is written
 * BEFORE the message goes, which makes this at-most-once: a crash between
 * the two loses a reminder, and never sends one twice.
 *
 * "Today" is the school's calendar date, from the student's branch time zone.
 * Invoice and loan due dates are stored as UTC midnight of a calendar date,
 * so they compare as dates, not instants.
 */

const DAY_MS = 86_400_000;

interface Candidate {
  subjectId: string;
  /** Days until due (due soon) or past due (overdue), on the school's calendar. */
  dayDelta: number;
  facts: EventFacts;
  studentId: string | null;
}

const zoneOf = (tz: string | null | undefined) => (tz && isValidTimeZone(tz) ? tz : "UTC");
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

async function invoiceCandidates(kind: "invoice.due_soon" | "invoice.overdue", organizationId: string, offset: number, now: Date): Promise<Candidate[]> {
  // Scan only due dates that could possibly be in the window. A couple of
  // days' slack either side absorbs the gap between UTC and any campus clock.
  const range =
    kind === "invoice.due_soon"
      ? { gte: new Date(now.getTime() - 2 * DAY_MS), lte: new Date(now.getTime() + (offset + 2) * DAY_MS) }
      : { gte: new Date(now.getTime() - (offset + CATCH_UP_DAYS + 2) * DAY_MS), lte: new Date(now.getTime() - (offset - 2) * DAY_MS) };

  const invoices = await db.invoice.findMany({
    where: { organizationId, status: { in: ["PENDING", "PARTIAL"] }, dueDate: range, student: { deletedAt: null } },
    include: {
      student: {
        select: { id: true, firstName: true, lastName: true, branch: { select: { timezone: true } }, currentSection: { select: { grade: { select: { name: true } } } } },
      },
      payments: { include: { refunds: true } },
    },
    take: 2000,
  });

  const out: Candidate[] = [];
  for (const inv of invoices) {
    const outstandingMinor = toMinor(inv.totalAmount) - paidMinorOf(inv);
    // Paid in full since the status was last written: nothing to remind about.
    if (outstandingMinor <= 0) continue;
    const today = localDateISO(now, zoneOf(inv.student.branch.timezone));
    const due = isoDate(inv.dueDate);
    const dayDelta = kind === "invoice.due_soon" ? daysBetween(today, due) : daysBetween(due, today);
    out.push({
      subjectId: inv.id,
      dayDelta,
      studentId: inv.student.id,
      facts: {
        "invoice.number": inv.invoiceNumber,
        "invoice.outstanding": outstandingMinor / 100,
        "invoice.dueDate": due,
        "student.name": `${inv.student.firstName} ${inv.student.lastName}`,
        "student.grade": inv.student.currentSection?.grade.name ?? null,
        days: dayDelta,
      },
    });
  }
  return out;
}

async function loanCandidates(organizationId: string, offset: number, now: Date): Promise<Candidate[]> {
  const loans = await db.libraryIssue.findMany({
    where: {
      returnedAt: null,
      dueAt: { gte: new Date(now.getTime() - (offset + CATCH_UP_DAYS + 2) * DAY_MS), lte: new Date(now.getTime() - (offset - 2) * DAY_MS) },
      libraryItem: { deletedAt: null, branch: { organizationId } },
    },
    include: {
      libraryItem: { select: { title: true, branch: { select: { timezone: true } } } },
      student: { select: { id: true, firstName: true, lastName: true } },
      staff: { select: { user: { select: { name: true } } } },
    },
    take: 2000,
  });

  return loans.map((loan) => {
    const today = localDateISO(now, zoneOf(loan.libraryItem.branch.timezone));
    const due = isoDate(loan.dueAt);
    const dayDelta = daysBetween(due, today);
    return {
      subjectId: loan.id,
      dayDelta,
      studentId: loan.student?.id ?? null,
      facts: {
        "book.title": loan.libraryItem.title,
        "borrower.name": loan.student ? `${loan.student.firstName} ${loan.student.lastName}` : (loan.staff?.user.name ?? "Unknown borrower"),
        "borrower.kind": loan.student ? "student" : "staff",
        "loan.dueDate": due,
        "loan.daysOverdue": dayDelta,
      },
    };
  });
}

function candidatesFor(kind: ScheduledEventKind, organizationId: string, offset: number, now: Date): Promise<Candidate[]> {
  return kind === "library.overdue" ? loanCandidates(organizationId, offset, now) : invoiceCandidates(kind, organizationId, offset, now);
}

/** Insert the run row that claims this (rule, subject). Null when someone already did. */
async function claim(ruleId: string, dedupeKey: string, outcome: "MATCHED" | "SKIPPED", facts: EventFacts, detail: string): Promise<string | null> {
  try {
    const run = await db.automationRun.create({ data: { ruleId, dedupeKey, outcome, facts: facts as object, detail } });
    return run.id;
  } catch (e) {
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") return null;
    throw e;
  }
}

export async function evaluateDateRules(now: Date, organizationId: string | null): Promise<Record<string, number>> {
  const rules = await db.automationRule.findMany({
    where: { active: true, deletedAt: null, eventKind: { in: SCHEDULED_EVENT_KINDS }, ...(organizationId ? { organizationId } : {}) },
    orderBy: { createdAt: "asc" },
  });

  const summary = { rulesChecked: 0, rulesErrored: 0, inWindow: 0, acted: 0, conditionsNotMet: 0, alreadyHandled: 0, failed: 0 };
  const flagOn = new Map<string, boolean>();

  for (const rule of rules) {
    if (!isScheduledKind(rule.eventKind)) continue;
    let on = flagOn.get(rule.organizationId);
    if (on === undefined) {
      on = await isFeatureEnabled(AUTOMATION_FLAG, rule.organizationId);
      flagOn.set(rule.organizationId, on);
    }
    if (!on) continue;
    summary.rulesChecked++;

    // One broken rule must not stop every other school's reminders.
    try {
      const kind = rule.eventKind;
      const offset = effectiveOffset(kind, rule.offsetDays);
      const conditions = (rule.conditions ?? []) as unknown as Condition[];

      for (const c of await candidatesFor(kind, rule.organizationId, offset, now)) {
        if (!scheduledWindowHit(kind, offset, c.dayDelta)) continue;
        summary.inWindow++;
        const key = `${rule.id}:${c.subjectId}`;

        if (!matches(conditions, c.facts)) {
          // Recorded once per subject rather than every hour. A separate key,
          // so if the facts change (a part-payment moves the balance under a
          // threshold) the rule can still act later.
          await claim(rule.id, `${key}:skipped`, "SKIPPED", c.facts, "Conditions not met");
          summary.conditionsNotMet++;
          continue;
        }

        const runId = await claim(rule.id, key, "MATCHED", c.facts, "Sending…");
        if (!runId) {
          summary.alreadyHandled++;
          continue;
        }
        try {
          const detail = await performRuleAction(rule, c.facts, { organizationId: rule.organizationId, studentId: c.studentId });
          await db.automationRun.update({ where: { id: runId }, data: { detail } });
          summary.acted++;
        } catch (e) {
          await db.automationRun.update({
            where: { id: runId },
            data: { outcome: "FAILED", detail: e instanceof Error ? e.message : "Unknown error" },
          });
          summary.failed++;
        }
      }
    } catch (e) {
      console.error(`[automation] date rule ${rule.id} failed`, e);
      summary.rulesErrored++;
    }
  }

  return summary;
}
