"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ForbiddenError, authorize } from "@/lib/rbac";
import { withBranch } from "@/lib/branch-context";
import { actorOf, requireAdmissionsAccessForAction, str } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { fieldErrors } from "@/modules/sis/schemas";
import { SisError } from "@/modules/sis/students.service";
import { isApplicationStatus, isLeadStage } from "@/modules/admissions/pipeline";
import {
  appointmentSchema,
  applicationInputSchema,
  assignSchema,
  campaignSchema,
  convertSchema,
  decisionSchema,
  documentSchema,
  followUpSchema,
  leadInputSchema,
  noteSchema,
  sourceSchema,
  stageMoveSchema,
} from "@/modules/admissions/schemas";
import {
  DuplicateLeadError,
  addLeadNote,
  assignCounselor,
  createCampaign,
  createLead,
  createSource,
  moveLeadStage,
  setFollowUp,
} from "@/modules/admissions/leads.service";
import {
  addDocument,
  convertApplication,
  moveApplication,
  openApplication,
  scheduleAppointment,
  setAppointmentStatus,
  setDocumentVerified,
} from "@/modules/admissions/applications.service";

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

// --- Leads -----------------------------------------------------------------------

export async function createLeadAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let leadId: string;
  let ctx: Ctx;
  try {
    const access = await requireAdmissionsAccessForAction(str(formData, "branchId"), "admissions.leads", "create");
    const parsed = leadInputSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    const lead = await createLead(parsed.data, { organizationId: access.ctx.organizationId, branchId: access.ctx.branch.id, actorUserId: access.viewer.userId });
    leadId = lead.id;
    ctx = access.ctx;
  } catch (e) {
    if (e instanceof DuplicateLeadError) return { error: `${e.message}. Open the existing lead instead of creating a duplicate.` };
    return toFormState(e);
  }
  revalidatePath("/admissions");
  redirect(withBranch(`/admissions/leads/${leadId}`, ctx as never));
}

export async function moveLeadStageAction(leadId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAdmissionsAccessForAction(str(formData, "branchId"), "admissions.leads", "configure");
    const parsed = stageMoveSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    if (!isLeadStage(parsed.data.stage)) return { error: "Unknown stage" };
    await moveLeadStage(leadId, parsed.data.stage, parsed.data.note, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/admissions/leads/${leadId}`);
  revalidatePath("/admissions");
  return { success: "Stage updated" };
}

export async function assignCounselorAction(leadId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAdmissionsAccessForAction(str(formData, "branchId"), "admissions.leads", "configure");
    const parsed = assignSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await assignCounselor(leadId, parsed.data.counselorUserId ?? null, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/admissions/leads/${leadId}`);
  return { success: "Assignment saved" };
}

export async function addNoteAction(leadId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAdmissionsAccessForAction(str(formData, "branchId"), "admissions.leads", "edit");
    const parsed = noteSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await addLeadNote(leadId, parsed.data.note, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/admissions/leads/${leadId}`);
  return { success: "Note added" };
}

export async function setFollowUpAction(leadId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAdmissionsAccessForAction(str(formData, "branchId"), "admissions.leads", "edit");
    const parsed = followUpSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await setFollowUp(leadId, parsed.data.nextFollowUpAt, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/admissions/leads/${leadId}`);
  revalidatePath("/admissions");
  return { success: "Follow-up saved" };
}

// --- Applications ---------------------------------------------------------------

export async function openApplicationAction(leadId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAdmissionsAccessForAction(str(formData, "branchId"), "admissions.applications", "create");
    const parsed = applicationInputSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await openApplication(leadId, parsed.data, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/admissions/leads/${leadId}`);
  revalidatePath("/admissions");
  return { success: "Application opened" };
}

export async function addDocumentAction(applicationId: string, leadId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAdmissionsAccessForAction(str(formData, "branchId"), "admissions.applications", "edit");
    const parsed = documentSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await addDocument(applicationId, parsed.data.documentType, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/admissions/leads/${leadId}`);
  return { success: "Added to checklist" };
}

export async function toggleDocumentAction(formData: FormData): Promise<void> {
  const documentId = str(formData, "documentId");
  const leadId = str(formData, "leadId");
  const verified = str(formData, "verified") === "true";
  if (!documentId || !leadId) return;
  try {
    const access = await requireAdmissionsAccessForAction(str(formData, "branchId"), "admissions.applications", "edit");
    await setDocumentVerified(documentId, verified, actorOf(access));
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return;
    throw e;
  }
  revalidatePath(`/admissions/leads/${leadId}`);
}

export async function scheduleAppointmentAction(applicationId: string, leadId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAdmissionsAccessForAction(str(formData, "branchId"), "admissions.applications", "edit");
    const parsed = appointmentSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await scheduleAppointment(applicationId, parsed.data, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/admissions/leads/${leadId}`);
  return { success: "Appointment scheduled" };
}

export async function setAppointmentStatusAction(formData: FormData): Promise<void> {
  const appointmentId = str(formData, "appointmentId");
  const leadId = str(formData, "leadId");
  const status = str(formData, "status");
  if (!appointmentId || !leadId || !status || !["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"].includes(status)) return;
  try {
    const access = await requireAdmissionsAccessForAction(str(formData, "branchId"), "admissions.applications", "edit");
    await setAppointmentStatus(appointmentId, status as "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW", actorOf(access));
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return;
    throw e;
  }
  revalidatePath(`/admissions/leads/${leadId}`);
}

export async function moveApplicationAction(applicationId: string, leadId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAdmissionsAccessForAction(str(formData, "branchId"), "admissions.applications", "edit");
    const parsed = decisionSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    if (!isApplicationStatus(parsed.data.status)) return { error: "Unknown status" };
    const canApprove = await authorize(access.viewer.userId, "admissions.applications", "approve", {
      organizationId: access.ctx.organizationId,
      branchId: access.ctx.branch.id,
    });
    await moveApplication(applicationId, parsed.data.status, parsed.data.note, { canApprove }, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/admissions/leads/${leadId}`);
  revalidatePath("/admissions");
  return { success: "Application updated" };
}

export async function convertApplicationAction(applicationId: string, leadId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  let studentId: string;
  let ctx: Ctx;
  try {
    const access = await requireAdmissionsAccessForAction(str(formData, "branchId"), "admissions.applications", "approve");
    const canCreateStudent = await authorize(access.viewer.userId, "sis.students", "create", {
      organizationId: access.ctx.organizationId,
      branchId: access.ctx.branch.id,
    });
    if (!canCreateStudent) return { error: "Converting needs sis.students:create as well" };
    const parsed = convertSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    const student = await convertApplication(applicationId, parsed.data, actorOf(access));
    studentId = student.id;
    ctx = access.ctx;
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/admissions/leads/${leadId}`);
  revalidatePath("/admissions");
  revalidatePath("/students");
  redirect(withBranch(`/students/${studentId}`, ctx as never));
}

// --- Settings ----------------------------------------------------------------------

export async function createSourceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAdmissionsAccessForAction(str(formData, "branchId"), "admissions.settings", "configure");
    const parsed = sourceSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createSource(parsed.data.name, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/admissions/settings");
  return { success: "Source added" };
}

export async function createCampaignAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAdmissionsAccessForAction(str(formData, "branchId"), "admissions.settings", "configure");
    const parsed = campaignSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createCampaign(parsed.data, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/admissions/settings");
  return { success: "Campaign added" };
}
