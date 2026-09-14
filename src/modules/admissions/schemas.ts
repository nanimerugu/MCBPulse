import { z } from "zod";

const optionalText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().max(500).optional(),
);
const optionalEmail = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.email("Enter a valid email").optional(),
);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd");
const optionalIsoDate = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), isoDate.optional());

export const leadInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  phone: z.string().trim().min(5, "Phone is required").max(30),
  email: optionalEmail,
  sourceId: optionalText,
  campaignId: optionalText,
  note: optionalText,
});
export type LeadInput = z.infer<typeof leadInputSchema>;

export const stageMoveSchema = z.object({
  stage: z.string().min(1, "Choose a stage"),
  note: optionalText,
});

export const noteSchema = z.object({
  note: z.string().trim().min(1, "Write something").max(1000),
});

export const followUpSchema = z.object({
  nextFollowUpAt: optionalIsoDate,
});

export const assignSchema = z.object({
  counselorUserId: optionalText,
});

export const applicationInputSchema = z.object({
  applicantName: z.string().trim().min(1, "Applicant (child) name is required").max(100),
  gradeAppliedFor: z.string().trim().min(1, "Grade is required").max(50),
});

export const documentSchema = z.object({
  documentType: z.string().trim().min(1, "Document type is required").max(100),
});

export const appointmentSchema = z.object({
  type: z.enum(["INTERVIEW", "COUNSELING"]),
  scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a date and time"),
});

export const decisionSchema = z.object({
  status: z.string().min(1, "Choose a status"),
  note: optionalText,
});

export const convertSchema = z.object({
  admissionNumber: z.string().trim().min(1, "Admission number is required").max(50),
  sectionId: optionalText,
  guardianRelationship: z.enum(["FATHER", "MOTHER", "GUARDIAN", "OTHER"]),
});
export type ConvertInput = z.infer<typeof convertSchema>;

export const sourceSchema = z.object({ name: z.string().trim().min(1, "Name is required").max(60) });

export const campaignSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  channel: z.enum(["SMS", "EMAIL", "WHATSAPP", "SOCIAL", "LANDING_PAGE"]),
  startDate: isoDate,
  endDate: optionalIsoDate,
});

/** The public enquiry form. `website` is a honeypot: humans never see it, bots fill it. */
export const publicEnquirySchema = z.object({
  name: z.string().trim().min(2, "Please enter your name").max(100),
  phone: z.string().trim().min(7, "Please enter a phone number").max(30),
  email: optionalEmail,
  gradeInterest: optionalText,
  message: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(1000).optional()),
  website: z.preprocess((v) => (typeof v === "string" ? v : ""), z.string().max(0)),
});
export type PublicEnquiryInput = z.infer<typeof publicEnquirySchema>;
