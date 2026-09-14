import { z } from "zod";

const optionalText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().max(2000).optional(),
);

export const courseSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
  description: optionalText,
  subjectId: optionalText,
  gradeId: optionalText,
  curriculumId: optionalText,
});

export const moduleSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
});

export const lessonSchema = z.object({
  courseModuleId: z.string().min(1, "Choose a module"),
  title: z.string().trim().min(1, "Title is required").max(120),
  content: optionalText,
});

export const assignmentSchema = z.object({
  courseId: z.string().min(1, "Choose a course"),
  sectionId: z.string().min(1, "Choose a section"),
  title: z.string().trim().min(1, "Title is required").max(150),
  instructions: optionalText,
  // datetime-local, e.g. 2026-09-30T23:59
  dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a due date and time"),
  maxMarks: z.coerce.number().int().min(1, "Must be at least 1").max(1000),
});
export type AssignmentInput = z.infer<typeof assignmentSchema>;
