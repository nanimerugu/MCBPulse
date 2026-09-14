import type { ApplicationStatus, LeadStage } from "@/generated/prisma/enums";

/**
 * The admissions funnel from blueprint section 10.5 as two state machines.
 *
 * Leads:
 *   NEW ─▶ CONTACTED ─▶ QUALIFIED ─▶ APPLIED ─▶ ADMITTED (terminal)
 *    │        │            │           │
 *    └────────┴────────────┴───────────┴──▶ LOST ─▶ CONTACTED (nurture/reopen)
 *
 *   APPLIED and ADMITTED are set by the system — opening an application and
 *   converting an accepted one — never picked from a dropdown. That keeps
 *   "APPLIED" meaning "there is an application", not "someone said so".
 *
 * Applications:
 *   DOCUMENTS_PENDING ─▶ UNDER_REVIEW ─▶ OFFERED ─▶ ACCEPTED (then convert)
 *                            │    ▲          │
 *                            ▼    │          ▼
 *                        WAITLISTED       REJECTED (terminal)
 *   Any pre-decision status may be REJECTED. Decisions (OFFERED, WAITLISTED,
 *   ACCEPTED, REJECTED) need admissions.applications:approve.
 */

const LEAD_MANUAL: Record<LeadStage, LeadStage[]> = {
  NEW: ["CONTACTED", "QUALIFIED", "LOST"],
  CONTACTED: ["QUALIFIED", "LOST"],
  QUALIFIED: ["LOST"],
  APPLIED: ["LOST"],
  ADMITTED: [],
  LOST: ["CONTACTED"],
};

/** Stages a person may pick for a lead in `from`. */
export function manualLeadTransitions(from: LeadStage): LeadStage[] {
  return LEAD_MANUAL[from];
}

export function canMoveLead(from: LeadStage, to: LeadStage): boolean {
  return LEAD_MANUAL[from].includes(to);
}

/** Stages from which an application may be opened (moves the lead to APPLIED). */
export const LEAD_STAGES_OPEN_TO_APPLICATION: ReadonlySet<LeadStage> = new Set(["NEW", "CONTACTED", "QUALIFIED"]);

export const LEAD_STAGE_ORDER: readonly LeadStage[] = ["NEW", "CONTACTED", "QUALIFIED", "APPLIED", "ADMITTED", "LOST"];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  APPLIED: "Applied",
  ADMITTED: "Admitted",
  LOST: "Lost",
};

export function isLeadStage(value: string): value is LeadStage {
  return (LEAD_STAGE_ORDER as readonly string[]).includes(value);
}

const APPLICATION_NEXT: Record<ApplicationStatus, ApplicationStatus[]> = {
  DOCUMENTS_PENDING: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["OFFERED", "WAITLISTED", "REJECTED"],
  WAITLISTED: ["OFFERED", "REJECTED"],
  OFFERED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: [],
  REJECTED: [],
};

/** Statuses that are admissions decisions and therefore need `approve`. */
export const APPLICATION_DECISIONS: ReadonlySet<ApplicationStatus> = new Set(["OFFERED", "WAITLISTED", "ACCEPTED", "REJECTED"]);

export function applicationTransitions(from: ApplicationStatus): ApplicationStatus[] {
  return APPLICATION_NEXT[from];
}

export function canMoveApplication(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return APPLICATION_NEXT[from].includes(to);
}

export const APPLICATION_STATUS_ORDER: readonly ApplicationStatus[] = [
  "DOCUMENTS_PENDING",
  "UNDER_REVIEW",
  "WAITLISTED",
  "OFFERED",
  "ACCEPTED",
  "REJECTED",
];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  DOCUMENTS_PENDING: "Documents pending",
  UNDER_REVIEW: "Under review",
  WAITLISTED: "Waitlisted",
  OFFERED: "Offered",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
};

export function isApplicationStatus(value: string): value is ApplicationStatus {
  return (APPLICATION_STATUS_ORDER as readonly string[]).includes(value);
}

// Phone handling lives in src/lib/phone.ts so SIS and Admissions share one
// definition of "the same number"; re-exported here for the admissions code.
export { isPlausiblePhone, normalizePhone } from "@/lib/phone";
