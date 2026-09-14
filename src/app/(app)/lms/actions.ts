"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ForbiddenError } from "@/lib/rbac";
import { withBranch } from "@/lib/branch-context";
import { actorOf, requireLmsAccessForAction, str } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { fieldErrors } from "@/modules/sis/schemas";
import { SisError } from "@/modules/sis/students.service";
import { getSectionScope, sectionInScope } from "@/modules/academics/scope";
import { assignmentSchema, courseSchema, lessonSchema, moduleSchema } from "@/modules/lms/schemas";
import { addLesson, addModule, createCourse } from "@/modules/lms/courses.service";
import { createAssignment, deleteAssignment, publishAssignment, saveGrades, type GradeEntry } from "@/modules/lms/assignments.service";

function toFormState(error: unknown): FormState {
  if (error instanceof SisError || error instanceof ForbiddenError) return { error: error.message };
  throw error;
}
function values(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
type Ctx = { branch: { id: string }; branches: unknown[] };

// --- Courses ---------------------------------------------------------------------

export async function createCourseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let courseId: string;
  let ctx: Ctx;
  try {
    const access = await requireLmsAccessForAction(str(formData, "branchId"), "lms.courses", "create");
    const parsed = courseSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    const course = await createCourse(parsed.data, access.ctx.branch.id, actorOf(access));
    courseId = course.id;
    ctx = access.ctx;
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/lms/courses");
  redirect(withBranch(`/lms/courses/${courseId}`, ctx as never));
}

export async function addModuleAction(courseId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireLmsAccessForAction(str(formData, "branchId"), "lms.courses", "edit");
    const parsed = moduleSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await addModule(courseId, parsed.data.title, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/lms/courses/${courseId}`);
  return { success: "Module added" };
}

export async function addLessonAction(courseId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireLmsAccessForAction(str(formData, "branchId"), "lms.courses", "edit");
    const parsed = lessonSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await addLesson(parsed.data, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/lms/courses/${courseId}`);
  return { success: "Lesson added" };
}

// --- Assignments -------------------------------------------------------------------

export async function createAssignmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let assignmentId: string;
  let ctx: Ctx;
  try {
    const access = await requireLmsAccessForAction(str(formData, "branchId"), "lms.assignments", "create");
    const parsed = assignmentSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

    // A teacher may only set work for a section they actually teach.
    const scope = await getSectionScope(access);
    if (!sectionInScope(scope, parsed.data.sectionId)) return { error: "You aren't assigned to that section" };

    const a = await createAssignment(parsed.data, { branchId: access.ctx.branch.id, staffId: scope.staffId }, actorOf(access));
    assignmentId = a.id;
    ctx = access.ctx;
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/lms/assignments");
  redirect(withBranch(`/lms/assignments/${assignmentId}`, ctx as never));
}

export async function publishAssignmentAction(assignmentId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireLmsAccessForAction(str(formData, "branchId"), "lms.assignments", "publish");
    await publishAssignment(assignmentId, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/lms/assignments/${assignmentId}`);
  revalidatePath("/lms/assignments");
  revalidatePath("/dashboard");
  return { success: "Published" };
}

export async function deleteAssignmentAction(formData: FormData): Promise<void> {
  const assignmentId = str(formData, "assignmentId");
  if (!assignmentId) return;
  let ctx: Ctx;
  try {
    const access = await requireLmsAccessForAction(str(formData, "branchId"), "lms.assignments", "edit");
    await deleteAssignment(assignmentId, actorOf(access));
    ctx = access.ctx;
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return;
    throw e;
  }
  revalidatePath("/lms/assignments");
  redirect(withBranch("/lms/assignments", ctx as never));
}

/**
 * The grading roster posts one set of fields per student:
 *   submitted:<id>  yyyy-mm-dd or ""
 *   marks:<id>      number or ""
 *   feedback:<id>   text
 *   version:<id>    optimistic-lock token echoed from the render
 */
export async function saveGradesAction(assignmentId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireLmsAccessForAction(str(formData, "branchId"), "lms.grades", "edit");
    const scope = await getSectionScope(access);
    const sectionId = str(formData, "sectionId");
    if (!sectionInScope(scope, sectionId)) return { error: "You aren't assigned to that section" };

    const entries: GradeEntry[] = [];
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("marks:") || typeof value !== "string") continue;
      const studentId = key.slice("marks:".length);
      const rawMarks = value.trim();
      if (rawMarks !== "" && !/^\d+$/.test(rawMarks)) return { error: `Marks must be a whole number (got "${rawMarks}")` };
      const versionRaw = str(formData, `version:${studentId}`);
      entries.push({
        studentId,
        submittedOn: (str(formData, `submitted:${studentId}`) ?? "").trim(),
        marks: rawMarks === "" ? null : Number(rawMarks),
        feedback: str(formData, `feedback:${studentId}`) ?? "",
        version: versionRaw ? Number(versionRaw) : null,
      });
    }

    const r = await saveGrades(assignmentId, entries, { staffId: scope.staffId }, actorOf(access));
    revalidatePath(`/lms/assignments/${assignmentId}`);
    revalidatePath("/lms/gradebook");
    return { success: r.changed ? `Saved ${r.changed} row${r.changed === 1 ? "" : "s"}` : "No changes" };
  } catch (e) {
    return toFormState(e);
  }
}
