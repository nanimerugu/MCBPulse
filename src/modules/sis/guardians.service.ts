import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { EmergencyContactInput, LinkGuardianInput } from "@/modules/sis/schemas";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * Guardians are people, not per-student rows: one Guardian can be linked to
 * several students (siblings), which is how the blueprint's sibling
 * relationships work (section 9). `findGuardiansByPhone` is how the UI
 * offers "this parent already exists — link them" instead of creating a
 * duplicate.
 */

export async function findGuardiansByPhone(organizationId: string, phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return [];
  return db.guardian.findMany({
    where: {
      deletedAt: null,
      phone: { contains: digits.slice(-8) },
      // Only guardians already attached to a student in THIS organization —
      // Guardian itself is not tenant-scoped, StudentGuardian → Student is.
      studentLinks: { some: { student: { organizationId } } },
    },
    include: {
      studentLinks: { include: { student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } } } },
    },
    take: 10,
  });
}

export async function linkGuardian(studentId: string, input: LinkGuardianInput, actor: Actor) {
  const student = await db.student.findFirst({ where: { id: studentId, organizationId: actor.organizationId, deletedAt: null } });
  if (!student) throw new SisError("Student not found");

  const result = await db.$transaction(async (tx) => {
    let guardianId: string;
    let created = false;

    if (input.existingGuardianId) {
      // Must already be linked to some student in this org — same rule as
      // findGuardiansByPhone, enforced server-side not just in the picker.
      const existing = await tx.guardian.findFirst({
        where: {
          id: input.existingGuardianId,
          deletedAt: null,
          studentLinks: { some: { student: { organizationId: actor.organizationId } } },
        },
      });
      if (!existing) throw new SisError("That guardian isn't part of this organization");
      guardianId = existing.id;
    } else {
      const guardian = await tx.guardian.create({
        data: {
          firstName: input.firstName!,
          lastName: input.lastName!,
          phone: input.phone!,
          email: input.email ?? null,
          occupation: input.occupation ?? null,
        },
      });
      guardianId = guardian.id;
      created = true;
    }

    const already = await tx.studentGuardian.findUnique({ where: { studentId_guardianId: { studentId, guardianId } } });
    if (already) throw new SisError("This guardian is already linked to the student");

    if (input.isPrimary) {
      await tx.studentGuardian.updateMany({ where: { studentId, isPrimary: true }, data: { isPrimary: false } });
    }

    const link = await tx.studentGuardian.create({
      data: { studentId, guardianId, relationship: input.relationship, isPrimary: input.isPrimary },
      include: { guardian: true },
    });

    return { link, created };
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: result.created ? "guardian.created_and_linked" : "guardian.linked",
    resourceType: "student",
    resourceId: studentId,
    after: {
      guardianId: result.link.guardianId,
      guardian: `${result.link.guardian.firstName} ${result.link.guardian.lastName}`,
      relationship: result.link.relationship,
      isPrimary: result.link.isPrimary,
    },
  });

  return result.link;
}

export async function unlinkGuardian(linkId: string, actor: Actor) {
  const link = await db.studentGuardian.findFirst({
    where: { id: linkId, student: { organizationId: actor.organizationId } },
    include: { guardian: true },
  });
  if (!link) throw new SisError("Guardian link not found");

  await db.studentGuardian.delete({ where: { id: linkId } });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "guardian.unlinked",
    resourceType: "student",
    resourceId: link.studentId,
    before: { guardianId: link.guardianId, guardian: `${link.guardian.firstName} ${link.guardian.lastName}`, relationship: link.relationship },
  });
}

export async function addEmergencyContact(studentId: string, input: EmergencyContactInput, actor: Actor) {
  const student = await db.student.findFirst({ where: { id: studentId, organizationId: actor.organizationId, deletedAt: null } });
  if (!student) throw new SisError("Student not found");

  const contact = await db.emergencyContact.create({ data: { studentId, ...input } });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "student.emergency_contact_added",
    resourceType: "student",
    resourceId: studentId,
    after: { name: contact.name, phone: contact.phone, relationship: contact.relationship },
  });

  return contact;
}

export async function removeEmergencyContact(contactId: string, actor: Actor) {
  const contact = await db.emergencyContact.findFirst({
    where: { id: contactId, student: { organizationId: actor.organizationId } },
  });
  if (!contact) throw new SisError("Contact not found");

  await db.emergencyContact.delete({ where: { id: contactId } });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "student.emergency_contact_removed",
    resourceType: "student",
    resourceId: contact.studentId,
    before: { name: contact.name, phone: contact.phone },
  });
}
