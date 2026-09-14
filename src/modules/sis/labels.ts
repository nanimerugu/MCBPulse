import type { StudentStatus } from "@/generated/prisma/enums";
import type { BadgeTone } from "@/components/ui";

export const STUDENT_STATUS_LABELS: Record<StudentStatus, string> = {
  ENQUIRY: "Enquiry",
  APPLIED: "Applied",
  ENROLLED: "Enrolled",
  ALUMNI: "Alumni",
  WITHDRAWN: "Withdrawn",
  TRANSFERRED: "Transferred",
};

export const STUDENT_STATUS_TONES: Record<StudentStatus, BadgeTone> = {
  ENQUIRY: "neutral",
  APPLIED: "amber",
  ENROLLED: "green",
  ALUMNI: "blue",
  WITHDRAWN: "neutral",
  TRANSFERRED: "neutral",
};

export const STUDENT_STATUSES: StudentStatus[] = ["ENQUIRY", "APPLIED", "ENROLLED", "ALUMNI", "WITHDRAWN", "TRANSFERRED"];

export const GUARDIAN_RELATIONSHIP_LABELS = {
  FATHER: "Father",
  MOTHER: "Mother",
  GUARDIAN: "Guardian",
  OTHER: "Other",
} as const;

export function fullName(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

export function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}
