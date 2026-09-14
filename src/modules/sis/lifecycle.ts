import type { StudentStatus } from "@/generated/prisma/enums";

/**
 * The student lifecycle from blueprint section 10.2, as a state machine:
 *
 *   ENQUIRY ──enroll──▶ ENROLLED ──graduate──▶ ALUMNI (terminal)
 *   APPLIED ──enroll──▶    │  ▲
 *      │                   │  └─ promote (stays ENROLLED, section changes)
 *      └─ withdraw         ├──withdraw──▶ WITHDRAWN ──reenroll──▶ ENROLLED
 *                          └──transfer──▶ TRANSFERRED ──reenroll──▶ ENROLLED
 *
 * Pure: no DB, no side effects. The service layer asks `nextStatus()` and
 * refuses anything that returns null, so an impossible transition (graduating
 * an enquiry, promoting an alumnus) can't happen even by a buggy caller.
 */

export type LifecycleAction = "enroll" | "promote" | "transfer" | "withdraw" | "graduate" | "reenroll";

export const LIFECYCLE_ACTIONS: readonly LifecycleAction[] = [
  "enroll",
  "promote",
  "transfer",
  "withdraw",
  "graduate",
  "reenroll",
] as const;

const TRANSITIONS: Record<StudentStatus, Partial<Record<LifecycleAction, StudentStatus>>> = {
  ENQUIRY: { enroll: "ENROLLED", withdraw: "WITHDRAWN" },
  APPLIED: { enroll: "ENROLLED", withdraw: "WITHDRAWN" },
  ENROLLED: { promote: "ENROLLED", transfer: "TRANSFERRED", withdraw: "WITHDRAWN", graduate: "ALUMNI" },
  WITHDRAWN: { reenroll: "ENROLLED" },
  TRANSFERRED: { reenroll: "ENROLLED" },
  ALUMNI: {},
};

/** Actions that place the student in a section and therefore require one. */
export const ACTIONS_REQUIRING_SECTION: ReadonlySet<LifecycleAction> = new Set(["enroll", "promote", "reenroll"]);

/** Actions that remove the student from their current section. */
export const ACTIONS_CLEARING_SECTION: ReadonlySet<LifecycleAction> = new Set(["transfer", "withdraw", "graduate"]);

export function nextStatus(from: StudentStatus, action: LifecycleAction): StudentStatus | null {
  return TRANSITIONS[from][action] ?? null;
}

export function allowedActions(from: StudentStatus): LifecycleAction[] {
  return LIFECYCLE_ACTIONS.filter((a) => TRANSITIONS[from][a] !== undefined);
}

export function isLifecycleAction(value: string): value is LifecycleAction {
  return (LIFECYCLE_ACTIONS as readonly string[]).includes(value);
}

export const LIFECYCLE_LABELS: Record<LifecycleAction, string> = {
  enroll: "Enroll",
  promote: "Promote to next grade",
  transfer: "Transfer out",
  withdraw: "Withdraw",
  graduate: "Graduate (to alumni)",
  reenroll: "Re-enroll",
};
