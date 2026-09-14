"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ForbiddenError } from "@/lib/rbac";
import { withBranch } from "@/lib/branch-context";
import { actorOf, requireSisAccessForAction, str } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { isLifecycleAction } from "@/modules/sis/lifecycle";
import {
  emergencyContactSchema,
  fieldErrors,
  linkGuardianSchema,
  studentInputSchema,
} from "@/modules/sis/schemas";
import {
  SisError,
  applyLifecycleAction,
  archiveStudent,
  createStudent,
  updateStudent,
} from "@/modules/sis/students.service";
import {
  addEmergencyContact,
  linkGuardian,
  removeEmergencyContact,
  unlinkGuardian,
} from "@/modules/sis/guardians.service";
import { commitStudentImport, previewStudentImport } from "@/modules/sis/import.service";
import type { ImportValidationResult } from "@/modules/sis/import-validation";

/** Turns the errors a service is allowed to throw into form state; rethrows the rest. */
function toFormState(error: unknown): FormState {
  if (error instanceof SisError || error instanceof ForbiddenError) return { error: error.message };
  throw error;
}

function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

export async function createStudentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const branchId = str(formData, "branchId");
  let studentId: string;
  let branchCtx: { branch: { id: string }; branches: unknown[] };
  try {
    const access = await requireSisAccessForAction(branchId, "sis.students", "create");
    const parsed = studentInputSchema.safeParse(formValues(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    const student = await createStudent(parsed.data, { branchId: access.ctx.branch.id }, actorOf(access));
    studentId = student.id;
    branchCtx = access.ctx;
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/students");
  redirect(withBranch(`/students/${studentId}`, branchCtx as never));
}

export async function updateStudentAction(studentId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const branchId = str(formData, "branchId");
  let branchCtx: { branch: { id: string }; branches: unknown[] };
  try {
    const access = await requireSisAccessForAction(branchId, "sis.students", "edit");
    const parsed = studentInputSchema.safeParse(formValues(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await updateStudent(studentId, parsed.data, actorOf(access));
    branchCtx = access.ctx;
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  redirect(withBranch(`/students/${studentId}`, branchCtx as never));
}

export async function lifecycleAction(studentId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const branchId = str(formData, "branchId");
  const action = str(formData, "action") ?? "";
  try {
    const access = await requireSisAccessForAction(branchId, "sis.enrollment", "edit");
    if (!isLifecycleAction(action)) return { error: "Unknown action" };
    await applyLifecycleAction(
      studentId,
      { action, sectionId: str(formData, "sectionId") || undefined, note: str(formData, "note") || undefined },
      actorOf(access),
    );
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  return { success: `Done: ${action}` };
}

export async function archiveStudentAction(formData: FormData): Promise<void> {
  const branchId = str(formData, "branchId");
  const studentId = str(formData, "studentId");
  if (!studentId) return;
  let ctx: { branch: { id: string }; branches: unknown[] };
  try {
    const access = await requireSisAccessForAction(branchId, "sis.students", "delete");
    await archiveStudent(studentId, actorOf(access));
    ctx = access.ctx;
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return; // surfaced on next render as "not found"
    throw e;
  }
  revalidatePath("/students");
  redirect(withBranch("/students", ctx as never));
}

export async function linkGuardianAction(studentId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const branchId = str(formData, "branchId");
  try {
    const access = await requireSisAccessForAction(branchId, "sis.guardians", "create");
    const parsed = linkGuardianSchema.safeParse(formValues(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await linkGuardian(studentId, parsed.data, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/students/${studentId}`);
  return { success: "Guardian linked" };
}

export async function unlinkGuardianAction(formData: FormData): Promise<void> {
  const branchId = str(formData, "branchId");
  const linkId = str(formData, "linkId");
  const studentId = str(formData, "studentId");
  if (!linkId || !studentId) return;
  try {
    const access = await requireSisAccessForAction(branchId, "sis.guardians", "delete");
    await unlinkGuardian(linkId, actorOf(access));
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return;
    throw e;
  }
  revalidatePath(`/students/${studentId}`);
}

export async function addEmergencyContactAction(studentId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const branchId = str(formData, "branchId");
  try {
    const access = await requireSisAccessForAction(branchId, "sis.students", "edit");
    const parsed = emergencyContactSchema.safeParse(formValues(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await addEmergencyContact(studentId, parsed.data, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/students/${studentId}`);
  return { success: "Contact added" };
}

export async function removeEmergencyContactAction(formData: FormData): Promise<void> {
  const branchId = str(formData, "branchId");
  const contactId = str(formData, "contactId");
  const studentId = str(formData, "studentId");
  if (!contactId || !studentId) return;
  try {
    const access = await requireSisAccessForAction(branchId, "sis.students", "edit");
    await removeEmergencyContact(contactId, actorOf(access));
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return;
    throw e;
  }
  revalidatePath(`/students/${studentId}`);
}

// --- Import ------------------------------------------------------------------

export type ImportFormState =
  | {
      error?: string;
      preview?: ImportValidationResult & { tooManyRows: boolean; csvText: string; fileName: string };
    }
  | undefined;

const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

export async function previewImportAction(_prev: ImportFormState, formData: FormData): Promise<ImportFormState> {
  const branchId = str(formData, "branchId");
  const file = formData.get("file");
  try {
    const access = await requireSisAccessForAction(branchId, "sis.students", "create");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file" };
    if (file.size > IMPORT_MAX_BYTES) return { error: "File is larger than 2 MB" };
    const csvText = await file.text();
    const result = await previewStudentImport(csvText, { organizationId: access.ctx.organizationId, branchId: access.ctx.branch.id });
    return { preview: { ...result, csvText, fileName: file.name } };
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
}

export async function commitImportAction(_prev: ImportFormState, formData: FormData): Promise<ImportFormState> {
  const branchId = str(formData, "branchId");
  const csvText = str(formData, "csvText") ?? "";
  let created: number;
  let ctx: { branch: { id: string }; branches: unknown[] };
  try {
    const access = await requireSisAccessForAction(branchId, "sis.students", "create");
    if (csvText.length > IMPORT_MAX_BYTES) return { error: "File is larger than 2 MB" };
    const result = await commitStudentImport(csvText, { branchId: access.ctx.branch.id }, actorOf(access));
    created = result.created;
    ctx = access.ctx;
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  revalidatePath("/students");
  redirect(withBranch(`/students?imported=${created}`, ctx as never));
}
