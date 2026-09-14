import { z } from "zod";

/**
 * Form-input schemas for the SIS server actions. HTML forms post "" for an
 * empty optional field, so every optional string goes through `optionalText`
 * to become undefined instead of failing a min-length check.
 */

const optionalText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().max(500).optional(),
);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd");
const optionalIsoDate = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  isoDate.optional(),
);

export const studentInputSchema = z.object({
  admissionNumber: z.string().trim().min(1, "Admission number is required").max(50),
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  dateOfBirth: optionalIsoDate,
  gender: optionalText,
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  state: optionalText,
  postalCode: optionalText,
  bloodGroup: optionalText,
  medicalNotes: optionalText,
});
export type StudentInput = z.infer<typeof studentInputSchema>;

export const guardianRelationshipSchema = z.enum(["FATHER", "MOTHER", "GUARDIAN", "OTHER"]);

export const linkGuardianSchema = z
  .object({
    relationship: guardianRelationshipSchema,
    isPrimary: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
    // Either pick an existing guardian (a sibling's parent) ...
    existingGuardianId: optionalText,
    // ... or create a new one.
    firstName: optionalText,
    lastName: optionalText,
    phone: optionalText,
    email: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.email("Enter a valid email").optional(),
    ),
    occupation: optionalText,
  })
  .refine((v) => v.existingGuardianId || (v.firstName && v.lastName && v.phone), {
    message: "Pick an existing guardian, or give first name, last name and phone for a new one",
    path: ["firstName"],
  });
export type LinkGuardianInput = z.infer<typeof linkGuardianSchema>;

export const emergencyContactSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  phone: z.string().trim().min(1, "Phone is required").max(30),
  relationship: z.string().trim().min(1, "Relationship is required").max(50),
});
export type EmergencyContactInput = z.infer<typeof emergencyContactSchema>;

export const gradeInputSchema = z.object({
  name: z.string().trim().min(1, "Grade name is required").max(50),
  sequence: z.coerce.number().int().min(0).max(100),
});

export const sectionInputSchema = z.object({
  gradeId: z.string().min(1),
  name: z.string().trim().min(1, "Section name is required").max(20),
  capacity: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number().int().min(1).max(500).optional(),
  ),
});

export const staffInputSchema = z.object({
  email: z.email("Enter a valid email").trim().toLowerCase(),
  name: z.string().trim().min(1, "Name is required").max(100),
  employeeCode: z.string().trim().min(1, "Employee code is required").max(50),
  designation: z.string().trim().min(1, "Designation is required").max(100),
  joinDate: isoDate,
  roleKey: z.string().min(1, "Choose a role"),
  // Interim until Connect (Phase 6) can send invite emails: an admin may set
  // a first password. Leaving it blank creates the login in INVITED state
  // with no way to sign in yet.
  initialPassword: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().min(10, "At least 10 characters").max(200).optional(),
  ),
});
export type StaffInput = z.infer<typeof staffInputSchema>;

/** Flatten zod issues into `{ field: message }` for form rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
