/**
 * Row-level validation for the bulk student CSV import (blueprint 11.1:
 * "bulk import/export with mapping, validation preview, duplicate detection
 * and rollback"). Pure — takes parsed records and a snapshot of the relevant
 * DB state, returns per-row verdicts. The service runs it twice: once for the
 * preview the admin sees, and again at commit time against fresh DB state,
 * because the preview is a hidden form field the browser could have altered.
 */

export const IMPORT_COLUMNS = [
  "admission_number",
  "first_name",
  "last_name",
  "date_of_birth",
  "gender",
  "grade",
  "section",
  "guardian_name",
  "guardian_phone",
  "guardian_email",
  "guardian_relationship",
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/** Header aliases people actually type, normalized to the canonical column. */
const HEADER_ALIASES: Record<string, ImportColumn> = {
  admissionnumber: "admission_number",
  admissionno: "admission_number",
  admission: "admission_number",
  admno: "admission_number",
  firstname: "first_name",
  givenname: "first_name",
  lastname: "last_name",
  surname: "last_name",
  familyname: "last_name",
  dateofbirth: "date_of_birth",
  dob: "date_of_birth",
  birthdate: "date_of_birth",
  gender: "gender",
  sex: "gender",
  grade: "grade",
  class: "grade",
  standard: "grade",
  section: "section",
  division: "section",
  guardianname: "guardian_name",
  parentname: "guardian_name",
  guardianphone: "guardian_phone",
  parentphone: "guardian_phone",
  phone: "guardian_phone",
  mobile: "guardian_phone",
  guardianemail: "guardian_email",
  parentemail: "guardian_email",
  email: "guardian_email",
  guardianrelationship: "guardian_relationship",
  relationship: "guardian_relationship",
  relation: "guardian_relationship",
};

export function normalizeHeader(header: string): ImportColumn | null {
  const key = header.toLowerCase().replace(/[^a-z0-9]/g, "");
  return HEADER_ALIASES[key] ?? null;
}

export interface SectionRef {
  id: string;
  name: string;
  gradeName: string;
}

export interface ImportContext {
  /** Admission numbers already present in this organization. */
  existingAdmissionNumbers: ReadonlySet<string>;
  /** Sections in the current academic year of the target branch. */
  sections: readonly SectionRef[];
}

export interface StudentImportRow {
  rowNumber: number; // 1-based data row (header excluded), for error messages
  admissionNumber: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null; // ISO yyyy-mm-dd once validated
  gender: string | null;
  sectionId: string | null;
  guardian: {
    name: string;
    phone: string;
    email: string | null;
    relationship: GuardianRelationshipValue;
  } | null;
}

export type GuardianRelationshipValue = "FATHER" | "MOTHER" | "GUARDIAN" | "OTHER";

export interface ValidatedRow {
  rowNumber: number;
  raw: Record<string, string>;
  errors: string[];
  parsed: StudentImportRow | null;
}

export interface ImportValidationResult {
  /** Which CSV headers mapped to which canonical column (for the preview). */
  columnMap: Record<string, ImportColumn | null>;
  missingRequired: ImportColumn[];
  rows: ValidatedRow[];
  validCount: number;
  errorCount: number;
}

const REQUIRED: ImportColumn[] = ["admission_number", "first_name", "last_name"];

function parseRelationship(value: string): GuardianRelationshipValue | null {
  const v = value.trim().toUpperCase();
  if (v === "FATHER" || v === "DAD") return "FATHER";
  if (v === "MOTHER" || v === "MOM" || v === "MUM") return "MOTHER";
  if (v === "GUARDIAN") return "GUARDIAN";
  if (v === "OTHER" || v === "") return "OTHER";
  return null;
}

/** Accepts yyyy-mm-dd only; returns the same string if it's a real date. */
function parseIsoDate(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return value.trim();
}

export function validateStudentImport(
  headers: string[],
  records: Record<string, string>[],
  ctx: ImportContext,
): ImportValidationResult {
  const columnMap: Record<string, ImportColumn | null> = {};
  const byColumn = new Map<ImportColumn, string>(); // canonical -> actual header
  for (const h of headers) {
    const canonical = normalizeHeader(h);
    columnMap[h] = canonical;
    if (canonical && !byColumn.has(canonical)) byColumn.set(canonical, h);
  }
  const missingRequired = REQUIRED.filter((c) => !byColumn.has(c));

  const get = (rec: Record<string, string>, col: ImportColumn) => {
    const h = byColumn.get(col);
    return h ? (rec[h] ?? "").trim() : "";
  };

  const sectionIndex = new Map<string, SectionRef>();
  for (const s of ctx.sections) {
    sectionIndex.set(`${s.gradeName.toLowerCase()}|${s.name.toLowerCase()}`, s);
  }

  const seenInFile = new Set<string>();
  const rows: ValidatedRow[] = records.map((raw, i) => {
    const rowNumber = i + 1;
    const errors: string[] = [];
    if (missingRequired.length > 0) {
      return { rowNumber, raw, errors: [`Missing required column(s): ${missingRequired.join(", ")}`], parsed: null };
    }

    const admissionNumber = get(raw, "admission_number");
    const firstName = get(raw, "first_name");
    const lastName = get(raw, "last_name");

    if (!admissionNumber) errors.push("admission_number is required");
    if (!firstName) errors.push("first_name is required");
    if (!lastName) errors.push("last_name is required");

    if (admissionNumber) {
      const key = admissionNumber.toLowerCase();
      if (seenInFile.has(key)) errors.push(`Duplicate admission_number "${admissionNumber}" earlier in this file`);
      seenInFile.add(key);
      if (ctx.existingAdmissionNumbers.has(admissionNumber)) {
        errors.push(`admission_number "${admissionNumber}" already exists`);
      }
    }

    const dobRaw = get(raw, "date_of_birth");
    let dateOfBirth: string | null = null;
    if (dobRaw) {
      dateOfBirth = parseIsoDate(dobRaw);
      if (!dateOfBirth) errors.push(`date_of_birth "${dobRaw}" must be yyyy-mm-dd`);
    }

    const gender = get(raw, "gender") || null;

    const gradeName = get(raw, "grade");
    const sectionName = get(raw, "section");
    let sectionId: string | null = null;
    if (gradeName || sectionName) {
      if (!gradeName || !sectionName) {
        errors.push("grade and section must be given together");
      } else {
        const match = sectionIndex.get(`${gradeName.toLowerCase()}|${sectionName.toLowerCase()}`);
        if (!match) errors.push(`No section "${sectionName}" in grade "${gradeName}" for the current academic year`);
        else sectionId = match.id;
      }
    }

    const gName = get(raw, "guardian_name");
    const gPhone = get(raw, "guardian_phone");
    const gEmail = get(raw, "guardian_email") || null;
    const gRelRaw = get(raw, "guardian_relationship");
    let guardian: StudentImportRow["guardian"] = null;
    if (gName || gPhone || gEmail || gRelRaw) {
      if (!gName) errors.push("guardian_name is required when any guardian column is filled");
      if (!gPhone) errors.push("guardian_phone is required when any guardian column is filled");
      const relationship = parseRelationship(gRelRaw);
      if (!relationship) errors.push(`guardian_relationship "${gRelRaw}" must be FATHER, MOTHER, GUARDIAN or OTHER`);
      if (gName && gPhone && relationship) guardian = { name: gName, phone: gPhone, email: gEmail, relationship };
    }

    const parsed: StudentImportRow | null =
      errors.length === 0
        ? { rowNumber, admissionNumber, firstName, lastName, dateOfBirth, gender, sectionId, guardian }
        : null;

    return { rowNumber, raw, errors, parsed };
  });

  const errorCount = rows.filter((r) => r.errors.length > 0).length;
  return { columnMap, missingRequired, rows, validCount: rows.length - errorCount, errorCount };
}
