import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { csvToRecords } from "@/modules/sis/csv";
import {
  validateStudentImport,
  type ImportContext,
  type ImportValidationResult,
  type StudentImportRow,
} from "@/modules/sis/import-validation";
import { SisError, type Actor } from "@/modules/sis/students.service";

/** Rows per import. The preview travels back through a form field, so keep it bounded. */
export const IMPORT_MAX_ROWS = 2000;

async function buildImportContext(organizationId: string, branchId: string): Promise<ImportContext> {
  const [students, sections] = await Promise.all([
    db.student.findMany({ where: { organizationId }, select: { admissionNumber: true } }),
    db.section.findMany({
      where: { deletedAt: null, grade: { branchId, deletedAt: null }, academicYear: { isCurrent: true, deletedAt: null } },
      include: { grade: { select: { name: true } } },
    }),
  ]);
  return {
    existingAdmissionNumbers: new Set(students.map((s) => s.admissionNumber)),
    sections: sections.map((s) => ({ id: s.id, name: s.name, gradeName: s.grade.name })),
  };
}

export async function previewStudentImport(
  csvText: string,
  scope: { organizationId: string; branchId: string },
): Promise<ImportValidationResult & { tooManyRows: boolean }> {
  const { headers, rows } = csvToRecords(csvText);
  if (headers.length === 0) throw new SisError("The file is empty or has no header row");
  const tooManyRows = rows.length > IMPORT_MAX_ROWS;
  const ctx = await buildImportContext(scope.organizationId, scope.branchId);
  const result = validateStudentImport(headers, rows.slice(0, IMPORT_MAX_ROWS), ctx);
  return { ...result, tooManyRows };
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * Re-validates against fresh DB state (the preview may be minutes old and
 * came back through the browser), then writes everything in one transaction
 * — blueprint 11.1's "rollback": either every row lands or none does.
 */
export async function commitStudentImport(
  csvText: string,
  scope: { branchId: string },
  actor: Actor,
): Promise<{ created: number; admissionNumbers: string[] }> {
  const { headers, rows } = csvToRecords(csvText);
  if (rows.length > IMPORT_MAX_ROWS) throw new SisError(`At most ${IMPORT_MAX_ROWS} rows per import`);
  const ctx = await buildImportContext(actor.organizationId, scope.branchId);
  const result = validateStudentImport(headers, rows, ctx);
  if (result.errorCount > 0) {
    throw new SisError(`${result.errorCount} row(s) have errors — fix them and upload again`);
  }
  const valid = result.rows.map((r) => r.parsed).filter((r): r is StudentImportRow => r !== null);
  if (valid.length === 0) throw new SisError("Nothing to import");

  const created = await db.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const row of valid) {
      const student = await tx.student.create({
        data: {
          organizationId: actor.organizationId,
          branchId: scope.branchId,
          admissionNumber: row.admissionNumber,
          firstName: row.firstName,
          lastName: row.lastName,
          dateOfBirth: row.dateOfBirth ? new Date(`${row.dateOfBirth}T00:00:00.000Z`) : null,
          gender: row.gender,
          status: row.sectionId ? "ENROLLED" : "ENQUIRY",
          currentSectionId: row.sectionId,
          admissionDate: row.sectionId ? new Date() : null,
        },
      });
      ids.push(student.id);

      if (row.guardian) {
        const { firstName, lastName } = splitName(row.guardian.name);
        // Reuse a guardian already linked in this org with the same phone
        // (siblings in the same file / already on roll) instead of duplicating.
        const existing = await tx.guardian.findFirst({
          where: {
            phone: row.guardian.phone,
            deletedAt: null,
            studentLinks: { some: { student: { organizationId: actor.organizationId } } },
          },
        });
        const guardian =
          existing ??
          (await tx.guardian.create({
            data: { firstName, lastName, phone: row.guardian.phone, email: row.guardian.email },
          }));
        await tx.studentGuardian.create({
          data: { studentId: student.id, guardianId: guardian.id, relationship: row.guardian.relationship, isPrimary: true },
        });
      }
    }
    return ids;
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "students.imported",
    resourceType: "student_import",
    resourceId: null,
    after: { count: created.length, branchId: scope.branchId, admissionNumbers: valid.map((r) => r.admissionNumber) },
  });

  return { created: created.length, admissionNumbers: valid.map((r) => r.admissionNumber) };
}
