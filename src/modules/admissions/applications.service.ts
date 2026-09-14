import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { ApplicationStatus, AppointmentStatus, AppointmentType } from "@/generated/prisma/enums";
import { APPLICATION_DECISIONS, LEAD_STAGES_OPEN_TO_APPLICATION, canMoveApplication } from "@/modules/admissions/pipeline";
import { phoneMatchFilter } from "@/lib/phone";
import type { ConvertInput } from "@/modules/admissions/schemas";
import { SisError, type Actor } from "@/modules/sis/students.service";

async function requireApplication(applicationId: string, organizationId: string) {
  const application = await db.application.findFirst({
    where: { id: applicationId, lead: { organizationId, deletedAt: null } },
    include: { lead: true, documents: true },
  });
  if (!application) throw new SisError("Application not found");
  return application;
}

/**
 * Opening an application is what moves a lead to APPLIED — the stage is a
 * consequence, never a claim (see pipeline.ts).
 */
export async function openApplication(
  leadId: string,
  input: { applicantName: string; gradeAppliedFor: string },
  actor: Actor,
) {
  const lead = await db.lead.findFirst({ where: { id: leadId, organizationId: actor.organizationId, deletedAt: null } });
  if (!lead) throw new SisError("Lead not found");
  if (!LEAD_STAGES_OPEN_TO_APPLICATION.has(lead.stage) && lead.stage !== "APPLIED") {
    throw new SisError(`Can't open an application for a ${lead.stage.toLowerCase()} lead`);
  }

  const application = await db.$transaction(async (tx) => {
    const created = await tx.application.create({
      data: { leadId, applicantName: input.applicantName, gradeAppliedFor: input.gradeAppliedFor, submittedAt: new Date() },
    });
    if (lead.stage !== "APPLIED") await tx.lead.update({ where: { id: leadId }, data: { stage: "APPLIED" } });
    return created;
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "application.opened",
    resourceType: "lead",
    resourceId: leadId,
    before: { stage: lead.stage },
    after: { stage: "APPLIED", applicationId: application.id, applicant: input.applicantName, grade: input.gradeAppliedFor },
  });

  return application;
}

export async function addDocument(applicationId: string, documentType: string, actor: Actor) {
  const application = await requireApplication(applicationId, actor.organizationId);
  if (application.documents.some((d) => d.documentType.toLowerCase() === documentType.toLowerCase())) {
    throw new SisError(`"${documentType}" is already on the checklist`);
  }
  const doc = await db.applicationDocument.create({ data: { applicationId, documentType } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "application.document_added",
    resourceType: "lead",
    resourceId: application.leadId,
    after: { applicationId, documentType },
  });
  return doc;
}

export async function setDocumentVerified(documentId: string, verified: boolean, actor: Actor) {
  const doc = await db.applicationDocument.findFirst({
    where: { id: documentId, application: { lead: { organizationId: actor.organizationId } } },
    include: { application: { select: { leadId: true, id: true } } },
  });
  if (!doc) throw new SisError("Document not found");
  await db.applicationDocument.update({ where: { id: documentId }, data: { verified } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: verified ? "application.document_verified" : "application.document_unverified",
    resourceType: "lead",
    resourceId: doc.application.leadId,
    after: { applicationId: doc.application.id, documentType: doc.documentType },
  });
}

export async function scheduleAppointment(
  applicationId: string,
  input: { type: AppointmentType; scheduledAt: string },
  actor: Actor,
) {
  const application = await requireApplication(applicationId, actor.organizationId);
  const scheduledAt = new Date(`${input.scheduledAt}:00.000Z`);
  if (Number.isNaN(scheduledAt.getTime())) throw new SisError("Bad date/time");
  const appt = await db.appointment.create({ data: { applicationId, type: input.type, scheduledAt } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "application.appointment_scheduled",
    resourceType: "lead",
    resourceId: application.leadId,
    after: { applicationId, type: input.type, scheduledAt: input.scheduledAt },
  });
  return appt;
}

export async function setAppointmentStatus(appointmentId: string, status: AppointmentStatus, actor: Actor) {
  const appt = await db.appointment.findFirst({
    where: { id: appointmentId, application: { lead: { organizationId: actor.organizationId } } },
    include: { application: { select: { leadId: true, id: true } } },
  });
  if (!appt) throw new SisError("Appointment not found");
  await db.appointment.update({ where: { id: appointmentId }, data: { status } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "application.appointment_updated",
    resourceType: "lead",
    resourceId: appt.application.leadId,
    before: { status: appt.status },
    after: { applicationId: appt.application.id, status },
  });
}

/**
 * Moves an application along its status machine. Decisions (offer,
 * waitlist, accept, reject) require the caller to have `approve`; the
 * action layer passes what it verified.
 */
export async function moveApplication(
  applicationId: string,
  to: ApplicationStatus,
  note: string | undefined,
  opts: { canApprove: boolean },
  actor: Actor,
) {
  const application = await requireApplication(applicationId, actor.organizationId);
  if (!canMoveApplication(application.status, to)) {
    throw new SisError(`An application that is ${application.status.toLowerCase().replace("_", " ")} can't become ${to.toLowerCase().replace("_", " ")}`);
  }
  if (APPLICATION_DECISIONS.has(to) && !opts.canApprove) {
    throw new SisError("Admission decisions need admissions.applications:approve");
  }
  if (to === "UNDER_REVIEW" && application.documents.length > 0 && application.documents.some((d) => !d.verified)) {
    throw new SisError("Every document on the checklist must be verified before review");
  }

  await db.application.update({
    where: { id: applicationId },
    data: { status: to, ...(APPLICATION_DECISIONS.has(to) ? { decidedAt: new Date() } : {}) },
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: `application.${to.toLowerCase()}`,
    resourceType: "lead",
    resourceId: application.leadId,
    before: { status: application.status },
    after: { applicationId, status: to, ...(note ? { note } : {}) },
  });
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  return parts.length === 1 ? { firstName: parts[0], lastName: "" } : { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * The hand-off from Admissions to SIS (blueprint 10.2): an ACCEPTED
 * application becomes a Student, the lead's contact becomes their Guardian
 * (reusing an existing guardian with the same phone — a sibling's parent),
 * and the lead is ADMITTED. All in one transaction; the caller must hold
 * admissions.applications:approve AND sis.students:create.
 */
export async function convertApplication(applicationId: string, input: ConvertInput, actor: Actor) {
  const application = await requireApplication(applicationId, actor.organizationId);
  if (application.status !== "ACCEPTED") throw new SisError("Only an accepted application can be converted");
  if (application.convertedStudentId) throw new SisError("This application was already converted");
  const lead = application.lead;
  if (!lead.branchId) throw new SisError("The lead has no branch — set one before converting");

  const clash = await db.student.findFirst({ where: { organizationId: actor.organizationId, admissionNumber: input.admissionNumber }, select: { id: true } });
  if (clash) throw new SisError(`Admission number ${input.admissionNumber} is already in use`);

  let sectionLabel: string | null = null;
  if (input.sectionId) {
    const section = await db.section.findFirst({
      where: { id: input.sectionId, deletedAt: null, grade: { branchId: lead.branchId, deletedAt: null }, academicYear: { isCurrent: true, deletedAt: null } },
      include: { grade: true },
    });
    if (!section) throw new SisError("That section isn't in the lead's branch for the current academic year");
    sectionLabel = `${section.grade.name} / ${section.name}`;
  }

  const { firstName, lastName } = splitName(application.applicantName);
  const guardianName = splitName(lead.name);

  const result = await db.$transaction(async (tx) => {
    const student = await tx.student.create({
      data: {
        organizationId: actor.organizationId,
        branchId: lead.branchId!,
        admissionNumber: input.admissionNumber,
        firstName,
        lastName,
        status: input.sectionId ? "ENROLLED" : "APPLIED",
        currentSectionId: input.sectionId ?? null,
        admissionDate: new Date(),
      },
    });

    // Reuse a guardian only on a full-number match (see src/lib/phone.ts for
    // why a suffix match is not good enough).
    const phoneFilter = phoneMatchFilter(lead.phone);
    const existingGuardian = phoneFilter
      ? await tx.guardian.findFirst({
          where: { phone: phoneFilter, deletedAt: null, studentLinks: { some: { student: { organizationId: actor.organizationId } } } },
        })
      : null;
    const guardian =
      existingGuardian ??
      (await tx.guardian.create({ data: { firstName: guardianName.firstName, lastName: guardianName.lastName, phone: lead.phone, email: lead.email } }));
    await tx.studentGuardian.create({ data: { studentId: student.id, guardianId: guardian.id, relationship: input.guardianRelationship, isPrimary: true } });

    await tx.application.update({ where: { id: applicationId }, data: { convertedStudentId: student.id } });
    await tx.lead.update({ where: { id: lead.id }, data: { stage: "ADMITTED" } });

    return { student, guardian, guardianReused: Boolean(existingGuardian) };
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "student.created",
    resourceType: "student",
    resourceId: result.student.id,
    after: { admissionNumber: input.admissionNumber, name: application.applicantName, status: result.student.status, section: sectionLabel, fromApplication: applicationId, fromLead: lead.id },
  });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "lead.admitted",
    resourceType: "lead",
    resourceId: lead.id,
    before: { stage: lead.stage },
    after: { stage: "ADMITTED", studentId: result.student.id, admissionNumber: input.admissionNumber, guardianReused: result.guardianReused },
  });

  return result.student;
}
