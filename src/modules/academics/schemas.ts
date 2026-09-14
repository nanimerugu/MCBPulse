import { z } from "zod";
import { DAYS } from "@/modules/academics/timetable-conflicts";

const optionalText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().max(200).optional(),
);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd");
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:mm");

export const subjectInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  code: z.string().trim().min(1, "Code is required").max(20).toUpperCase(),
});

export const curriculumInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  type: z.enum(["STATE_BOARD", "CBSE", "IB", "CAMBRIDGE", "MONTESSORI", "PRESCHOOL", "HIGHER_ED"]),
});

export const assignmentInputSchema = z.object({
  sectionId: z.string().min(1, "Choose a section"),
  subjectId: z.string().min(1, "Choose a subject"),
  staffId: z.string().min(1, "Choose a teacher"),
});

export const slotInputSchema = z
  .object({
    sectionId: z.string().min(1, "Choose a section"),
    subjectId: z.string().min(1, "Choose a subject"),
    staffId: z.string().min(1, "Choose a teacher"),
    dayOfWeek: z.enum(DAYS as unknown as [string, ...string[]]),
    startTime: hhmm,
    endTime: hhmm,
    room: optionalText,
  })
  .refine((v) => v.startTime < v.endTime, { message: "End must be after start", path: ["endTime"] });
export type SlotInput = z.infer<typeof slotInputSchema>;

export const leaveInputSchema = z
  .object({
    fromDate: isoDate,
    toDate: isoDate,
    reason: z.string().trim().min(1, "Reason is required").max(500),
  })
  .refine((v) => v.fromDate <= v.toDate, { message: "End date must not be before start date", path: ["toDate"] });
export type LeaveInput = z.infer<typeof leaveInputSchema>;
