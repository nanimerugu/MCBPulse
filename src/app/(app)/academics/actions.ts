"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, authorize } from "@/lib/rbac";
import { actorOf, requireAcademicsAccessForAction, requireSisAccessForAction, str } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { fieldErrors } from "@/modules/sis/schemas";
import { SisError } from "@/modules/sis/students.service";
import { isDayOfWeek } from "@/modules/academics/timetable-conflicts";
import { isAttendanceStatus } from "@/modules/academics/attendance-summary";
import { assignmentInputSchema, curriculumInputSchema, leaveInputSchema, slotInputSchema, subjectInputSchema } from "@/modules/academics/schemas";
import { createCurriculum, createSubject } from "@/modules/academics/subjects.service";
import { removeAssignment, setAssignment } from "@/modules/academics/assignments.service";
import { createSlot, deleteSlot } from "@/modules/academics/timetable.service";
import { saveRegister, setSessionLock, type RegisterMark } from "@/modules/academics/attendance.service";
import { createStudentLeave, decideStudentLeave } from "@/modules/academics/leave.service";
import { getSectionScope, sectionInScope } from "@/modules/academics/scope";

function toFormState(error: unknown): FormState {
  if (error instanceof SisError || error instanceof ForbiddenError) return { error: error.message };
  throw error;
}

function values(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

// --- Subjects & curricula ------------------------------------------------------

export async function createSubjectAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAcademicsAccessForAction(str(formData, "branchId"), "academics.subjects", "configure");
    const parsed = subjectInputSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createSubject(parsed.data, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/academics/subjects");
  return { success: "Subject added" };
}

export async function createCurriculumAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAcademicsAccessForAction(str(formData, "branchId"), "academics.subjects", "configure");
    const parsed = curriculumInputSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createCurriculum(parsed.data, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/academics/subjects");
  return { success: "Curriculum added" };
}

// --- Teaching assignments ------------------------------------------------------

export async function setAssignmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAcademicsAccessForAction(str(formData, "branchId"), "academics.assignments", "configure");
    const parsed = assignmentInputSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await setAssignment(parsed.data, access.ctx.branch.id, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/academics/assignments");
  revalidatePath("/students");
  return { success: "Teacher assigned" };
}

export async function removeAssignmentAction(formData: FormData): Promise<void> {
  const id = str(formData, "assignmentId");
  if (!id) return;
  try {
    const access = await requireAcademicsAccessForAction(str(formData, "branchId"), "academics.assignments", "configure");
    await removeAssignment(id, actorOf(access));
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return;
    throw e;
  }
  revalidatePath("/academics/assignments");
  revalidatePath("/students");
}

// --- Timetable -----------------------------------------------------------------

export async function createSlotAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAcademicsAccessForAction(str(formData, "branchId"), "academics.timetable", "configure");
    const parsed = slotInputSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    if (!isDayOfWeek(parsed.data.dayOfWeek)) return { error: "Unknown day" };
    await createSlot({ ...parsed.data, dayOfWeek: parsed.data.dayOfWeek }, access.ctx.branch.id, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/academics/timetable");
  revalidatePath("/dashboard");
  return { success: "Slot added" };
}

export async function deleteSlotAction(formData: FormData): Promise<void> {
  const id = str(formData, "slotId");
  if (!id) return;
  try {
    const access = await requireAcademicsAccessForAction(str(formData, "branchId"), "academics.timetable", "configure");
    await deleteSlot(id, actorOf(access));
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return;
    throw e;
  }
  revalidatePath("/academics/timetable");
  revalidatePath("/dashboard");
}

// --- Attendance ----------------------------------------------------------------

export async function saveRegisterAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const sectionId = str(formData, "sectionId") ?? "";
  const dateISO = str(formData, "date") ?? "";
  try {
    const access = await requireAcademicsAccessForAction(str(formData, "branchId"), "academics.attendance", "create");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return { error: "Bad date" };

    const scope = await getSectionScope(access);
    if (!sectionInScope(scope, sectionId)) return { error: "You aren't assigned to this section" };

    const marks: RegisterMark[] = [];
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("status:") || typeof value !== "string" || !isAttendanceStatus(value)) continue;
      const studentId = key.slice("status:".length);
      const versionRaw = str(formData, `version:${studentId}`);
      marks.push({
        studentId,
        status: value,
        remarks: str(formData, `remarks:${studentId}`),
        version: versionRaw ? Number(versionRaw) : undefined,
      });
    }

    const canApprove = await authorize(access.viewer.userId, "academics.attendance", "approve", {
      organizationId: access.ctx.organizationId,
      branchId: access.ctx.branch.id,
    });
    const result = await saveRegister(sectionId, dateISO, marks, { staffId: scope.staffId, canApprove, branchId: access.ctx.branch.id }, actorOf(access));
    revalidatePath("/academics/attendance");
    revalidatePath("/dashboard");
    return { success: result.created ? "Register saved" : result.changed ? `Corrected ${result.changed} record${result.changed === 1 ? "" : "s"}` : "No changes" };
  } catch (e) {
    return toFormState(e);
  }
}

export async function setLockAction(formData: FormData): Promise<void> {
  const sessionId = str(formData, "sessionId");
  const locked = str(formData, "locked") === "true";
  if (!sessionId) return;
  try {
    const access = await requireAcademicsAccessForAction(str(formData, "branchId"), "academics.attendance", "approve");
    await setSessionLock(sessionId, locked, actorOf(access));
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return;
    throw e;
  }
  revalidatePath("/academics/attendance");
}

// --- Student leave (lives on the Student 360, hence the SIS gate) ------------------

export async function createLeaveAction(studentId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireSisAccessForAction(str(formData, "branchId"), "sis.students", "edit");
    const parsed = leaveInputSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createStudentLeave(studentId, parsed.data, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/students/${studentId}`);
  return { success: "Leave recorded — pending approval" };
}

export async function decideLeaveAction(formData: FormData): Promise<void> {
  const leaveId = str(formData, "leaveId");
  const studentId = str(formData, "studentId");
  const decision = str(formData, "decision");
  if (!leaveId || !studentId || (decision !== "APPROVED" && decision !== "REJECTED")) return;
  try {
    const access = await requireAcademicsAccessForAction(str(formData, "branchId"), "academics.attendance", "approve");
    await decideStudentLeave(leaveId, decision, actorOf(access));
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return;
    throw e;
  }
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/academics/attendance");
}
