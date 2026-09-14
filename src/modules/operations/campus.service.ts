import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { ClinicOutcome, VisitorKind } from "@/generated/prisma/enums";
import { notifyStudentGuardians, unreachedWarning, type GuardianNotifyOutcome } from "@/modules/connect/notify";
import { emit } from "@/modules/automation/automation.service";
import { SisError, type Actor } from "@/modules/sis/students.service";
import type { OpsScope } from "@/modules/operations/library.service";

/**
 * The two campus-safety registers: who is on site, and who went to the
 * infirmary. Both are records a school gets asked to produce after something
 * has gone wrong, so both are append-mostly and fully audited.
 */

// --- Visitors ----------------------------------------------------------------

export async function listVisitors(scope: OpsScope, opts: { onSiteOnly?: boolean } = {}) {
  return db.visitorLog.findMany({
    where: { branchId: scope.branchId, ...(opts.onSiteOnly ? { checkOutAt: null } : {}) },
    include: { student: true },
    orderBy: [{ checkOutAt: "asc" }, { checkInAt: "desc" }],
    take: 100,
  });
}

export async function countOnSite(scope: OpsScope) {
  return db.visitorLog.count({ where: { branchId: scope.branchId, checkOutAt: null } });
}

export async function checkInVisitor(
  input: { name: string; phone?: string; kind: VisitorKind; purpose: string; whomToMeet?: string; studentId?: string; passNumber?: string },
  scope: OpsScope,
  actor: Actor,
) {
  if (input.studentId) {
    const student = await db.student.findFirst({
      where: { id: input.studentId, organizationId: scope.organizationId, deletedAt: null },
    });
    if (!student) throw new SisError("Student not found");
  }

  const visit = await db.visitorLog.create({
    data: {
      branchId: scope.branchId,
      name: input.name,
      phone: input.phone ?? null,
      kind: input.kind,
      purpose: input.purpose,
      whomToMeet: input.whomToMeet ?? null,
      studentId: input.studentId ?? null,
      passNumber: input.passNumber ?? null,
      checkedInByUserId: actor.userId,
    },
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "visitor.checked_in",
    resourceType: "visitor_log",
    resourceId: visit.id,
    after: { name: input.name, kind: input.kind, purpose: input.purpose, passNumber: input.passNumber ?? null },
  });
  return visit;
}

export async function checkOutVisitor(visitId: string, scope: OpsScope, actor: Actor) {
  const visit = await db.visitorLog.findFirst({ where: { id: visitId, branchId: scope.branchId } });
  if (!visit) throw new SisError("Visitor record not found");
  if (visit.checkOutAt) throw new SisError("This visitor is already checked out");

  const checkOutAt = new Date();
  // Conditional so a double-tap at the gate can't overwrite the first time.
  const closed = await db.visitorLog.updateMany({
    where: { id: visitId, checkOutAt: null },
    data: { checkOutAt, checkedOutByUserId: actor.userId },
  });
  if (closed.count === 0) throw new SisError("This visitor is already checked out");

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "visitor.checked_out",
    resourceType: "visitor_log",
    resourceId: visitId,
    after: { name: visit.name, checkOutAt: checkOutAt.toISOString() },
  });
}

// --- Infirmary ---------------------------------------------------------------

const OUTCOMES_WORTH_TELLING_A_PARENT: ClinicOutcome[] = ["SENT_HOME", "REFERRED_TO_HOSPITAL"];

export async function listClinicVisits(scope: OpsScope, opts: { studentId?: string } = {}) {
  return db.clinicVisit.findMany({
    where: { branchId: scope.branchId, ...(opts.studentId ? { studentId: opts.studentId } : {}) },
    include: { student: { include: { currentSection: { include: { grade: true } } } } },
    orderBy: { visitedAt: "desc" },
    take: 100,
  });
}

/**
 * Record an infirmary visit, and tell the guardians when the outcome warrants
 * it. "Sent home" and "referred to hospital" always notify; a grazed knee
 * treated and returned to class does not, because a school that texts about
 * every plaster trains parents to ignore the messages that matter.
 *
 * The notification is urgent, so it overrides quiet hours — see
 * notifyStudentGuardians. It is also best-effort: the clinical record is
 * saved whether or not the message goes out, and what happened to the
 * message is visible in the delivery log.
 */
export async function recordClinicVisit(
  input: { studentId: string; complaint: string; treatment?: string; outcome: ClinicOutcome; temperatureCelsius?: number; notifyGuardians: boolean },
  scope: OpsScope & { branchName: string },
  actor: Actor,
) {
  const student = await db.student.findFirst({
    where: { id: input.studentId, organizationId: scope.organizationId, deletedAt: null },
    include: { currentSection: { include: { grade: true } } },
  });
  if (!student) throw new SisError("Student not found");
  if (input.temperatureCelsius !== undefined && (input.temperatureCelsius < 30 || input.temperatureCelsius > 45)) {
    throw new SisError("Temperature must be between 30 and 45 °C");
  }

  const shouldNotify = input.notifyGuardians || OUTCOMES_WORTH_TELLING_A_PARENT.includes(input.outcome);

  const visit = await db.clinicVisit.create({
    data: {
      branchId: scope.branchId,
      studentId: input.studentId,
      complaint: input.complaint,
      treatment: input.treatment ?? null,
      outcome: input.outcome,
      temperatureCelsius: input.temperatureCelsius === undefined ? null : input.temperatureCelsius.toFixed(1),
      recordedByUserId: actor.userId,
    },
  });

  let notified: GuardianNotifyOutcome = { queued: 0, sent: 0, suppressed: [], guardiansOnRecord: 0 };
  let unreached: string | null = null;
  if (shouldNotify) {
    const section = student.currentSection ? `${student.currentSection.grade.name} / ${student.currentSection.name}` : "";
    const body = `${scope.branchName}: ${student.firstName} ${student.lastName}${section ? ` (${section})` : ""} was seen by the school infirmary today — ${input.complaint}. ${CLINIC_OUTCOME_SENTENCE[input.outcome]} Please contact the school office.`;
    notified = await notifyStudentGuardians(input.studentId, body, scope, { urgent: true });
    if (notified.queued > 0) {
      await db.clinicVisit.update({ where: { id: visit.id }, data: { guardianNotifiedAt: new Date() } });
    }
    // "Recorded" and "the family knows" are different facts. If the message
    // reached nobody, say so loudly instead of letting a nurse assume a
    // parent was told about a child being sent home.
    unreached = unreachedWarning(notified);
  }

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "clinic_visit.recorded",
    resourceType: "student",
    resourceId: input.studentId,
    after: { visitId: visit.id, outcome: input.outcome, notified: notified.queued, unreached: unreached ?? undefined },
  });

  // A school may want its own rule on top of the built-in notice — "tell me
  // whenever anyone is referred to hospital", say. Emitted after the record
  // is safely written.
  await emit(
    "clinic.visit",
    {
      "student.name": student.firstName + " " + student.lastName,
      "clinic.outcome": input.outcome,
      "clinic.complaint": input.complaint,
    },
    { organizationId: scope.organizationId, studentId: input.studentId, userId: actor.userId },
  );

  return { visit, notified, unreached };
}

export const CLINIC_OUTCOME_LABELS: Record<ClinicOutcome, string> = {
  RETURNED_TO_CLASS: "Returned to class",
  SENT_HOME: "Sent home",
  REFERRED_TO_HOSPITAL: "Referred to hospital",
  OBSERVATION: "Kept under observation",
};

const CLINIC_OUTCOME_SENTENCE: Record<ClinicOutcome, string> = {
  RETURNED_TO_CLASS: "They have returned to class.",
  SENT_HOME: "We are sending them home.",
  REFERRED_TO_HOSPITAL: "They have been referred to hospital.",
  OBSERVATION: "They are being kept under observation at school.",
};

export const VISITOR_KIND_LABELS: Record<VisitorKind, string> = {
  GUARDIAN: "Parent / guardian",
  VENDOR: "Vendor",
  CONTRACTOR: "Contractor",
  OFFICIAL: "Official",
  ALUMNI: "Alumni",
  OTHER: "Other",
};

export const VISITOR_KINDS: VisitorKind[] = ["GUARDIAN", "VENDOR", "CONTRACTOR", "OFFICIAL", "ALUMNI", "OTHER"];
export const CLINIC_OUTCOMES: ClinicOutcome[] = ["RETURNED_TO_CLASS", "OBSERVATION", "SENT_HOME", "REFERRED_TO_HOSPITAL"];
