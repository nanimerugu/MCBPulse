"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ForbiddenError } from "@/lib/rbac";
import { withBranch } from "@/lib/branch-context";
import { actorOf, requireConnectAccessForAction, str, type ModuleAccess } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { fieldErrors } from "@/modules/sis/schemas";
import { SisError } from "@/modules/sis/students.service";
import { parseAudience } from "@/modules/connect/audience";
import { createBroadcast, sendBroadcast, setGuardianOptOut, setQuietHours, type BroadcastScope } from "@/modules/connect/broadcasts.service";
import { createTemplate, updateTemplate } from "@/modules/connect/templates.service";

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

async function scopeOf(access: ModuleAccess): Promise<BroadcastScope> {
  return {
    organizationId: access.ctx.organizationId,
    branchId: access.ctx.branch.id,
    branchName: access.ctx.branch.name,
    organizationName: access.viewer.assignments[0]?.organization.name ?? "School",
  };
}

const channelEnum = z.enum(["SMS", "EMAIL", "WHATSAPP", "PUSH", "VOICE"]);

const templateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  channel: channelEnum,
  body: z.string().trim().min(1, "Body is required").max(2000),
});

const broadcastSchema = z.object({
  channel: channelEnum,
  subject: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(200).optional()),
  body: z.string().trim().min(1, "Body is required").max(2000),
  audienceKind: z.string().min(1, "Choose an audience"),
  sectionId: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().optional()),
  gradeId: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().optional()),
  scheduledAt: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a date and time").optional(),
  ),
});

const quietHoursSchema = z
  .object({
    start: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().regex(/^\d{2}:\d{2}$/).optional()),
    end: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().regex(/^\d{2}:\d{2}$/).optional()),
  })
  .refine((v) => (v.start && v.end) || (!v.start && !v.end), { message: "Set both ends of the window, or clear both", path: ["start"] });

export async function createTemplateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireConnectAccessForAction(str(formData, "branchId"), "connect.templates", "create");
    const parsed = templateSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createTemplate(parsed.data, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/connect/templates");
  return { success: "Template saved" };
}

export async function updateTemplateAction(templateId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireConnectAccessForAction(str(formData, "branchId"), "connect.templates", "edit");
    const parsed = templateSchema.omit({ channel: true }).safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await updateTemplate(templateId, parsed.data, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/connect/templates");
  return { success: "Template updated" };
}

export async function createBroadcastAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let broadcastId: string;
  let ctx: Ctx;
  try {
    const access = await requireConnectAccessForAction(str(formData, "branchId"), "connect.broadcasts", "create");
    const parsed = broadcastSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

    const audience = parseAudience({ kind: parsed.data.audienceKind, sectionId: parsed.data.sectionId, gradeId: parsed.data.gradeId });
    if (!audience) return { error: "That audience needs a section or grade to be chosen" };

    const b = await createBroadcast(
      { channel: parsed.data.channel, subject: parsed.data.subject, body: parsed.data.body, audience, scheduledAt: parsed.data.scheduledAt },
      await scopeOf(access),
      actorOf(access),
    );
    broadcastId = b.id;
    ctx = access.ctx;
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/connect/broadcasts");
  redirect(withBranch(`/connect/broadcasts/${broadcastId}`, ctx as never));
}

export async function sendBroadcastAction(broadcastId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireConnectAccessForAction(str(formData, "branchId"), "connect.broadcasts", "message");
    const outcome = await sendBroadcast(broadcastId, await scopeOf(access), actorOf(access), {
      ignoreQuietHours: str(formData, "ignoreQuietHours") === "true",
    });
    revalidatePath(`/connect/broadcasts/${broadcastId}`);
    revalidatePath("/connect/delivery");
    revalidatePath("/connect");
    if (outcome.deferredTo) {
      return { success: `Held for quiet hours — scheduled for ${outcome.deferredTo.toISOString().slice(0, 16).replace("T", " ")} UTC` };
    }
    return {
      success: `Recorded ${outcome.sent} message${outcome.sent === 1 ? "" : "s"}${outcome.failed ? `, ${outcome.failed} failed` : ""}${outcome.suppressed ? `, ${outcome.suppressed} suppressed` : ""}`,
    };
  } catch (e) {
    return toFormState(e);
  }
}

export async function setQuietHoursAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireConnectAccessForAction(str(formData, "branchId"), "connect.settings", "configure");
    const parsed = quietHoursSchema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await setQuietHours({ start: parsed.data.start ?? null, end: parsed.data.end ?? null }, actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/connect/settings");
  return { success: "Quiet hours saved" };
}

export async function setOptOutAction(formData: FormData): Promise<void> {
  const guardianId = str(formData, "guardianId");
  if (!guardianId) return;
  try {
    const access = await requireConnectAccessForAction(str(formData, "branchId"), "connect.settings", "configure");
    await setGuardianOptOut(
      guardianId,
      { optOutSms: str(formData, "optOutSms") === "true", optOutEmail: str(formData, "optOutEmail") === "true" },
      actorOf(access),
    );
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return;
    throw e;
  }
  revalidatePath("/connect/settings");
}
