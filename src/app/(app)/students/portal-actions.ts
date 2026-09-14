"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError } from "@/lib/rbac";
import { actorOf, requireSisAccessForAction, str } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { SisError } from "@/modules/sis/students.service";
import {
  invitePortalUser,
  sendPortalPasswordReset,
  withdrawPortalAccess,
  type PortalTarget,
} from "@/modules/identity/portal-access.service";

/**
 * Portal access from the Student 360. The target arrives as a bound argument,
 * which the browser sends back and could alter — so it is re-validated here,
 * and the service resolves it through the actor's organization, so an edited
 * id reaches nothing outside this school.
 */
const targetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("guardian"), guardianId: z.uuid(), studentId: z.uuid() }),
  z.object({ kind: z.literal("student"), studentId: z.uuid() }),
]);

function toFormState(error: unknown): FormState {
  if (error instanceof SisError || error instanceof ForbiddenError) return { error: error.message };
  throw error;
}

async function gate(rawTarget: unknown, formData: FormData) {
  const access = await requireSisAccessForAction(str(formData, "branchId"), "sis.portal_access", "edit");
  const parsed = targetSchema.safeParse(rawTarget);
  if (!parsed.success) throw new SisError("That person couldn't be found");
  return { access, target: parsed.data as PortalTarget };
}

export async function invitePortalAction(rawTarget: PortalTarget, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { access, target } = await gate(rawTarget, formData);
    let studentEmail: string | undefined;
    if (target.kind === "student") {
      const email = z.email().safeParse(str(formData, "email")?.trim().toLowerCase());
      if (!email.success) return { fieldErrors: { email: "Enter a valid email address" } };
      studentEmail = email.data;
    }
    const outcome = await invitePortalUser(target, studentEmail, actorOf(access));
    revalidatePath(`/students/${target.studentId}`);
    if (outcome.restored) return { success: "Portal access restored — they sign in with the password they already have." };
    if (outcome.delivered) return { success: `Invitation emailed to ${outcome.email}. The link works once, for 7 days.` };
    return {
      success: `No email provider is configured, so nothing was sent. Hand this link to ${outcome.email} yourself — it works once, for 7 days, and whoever opens it chooses the password: ${outcome.link}`,
    };
  } catch (e) {
    return toFormState(e);
  }
}

export async function resetPortalPasswordAction(rawTarget: PortalTarget, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { access, target } = await gate(rawTarget, formData);
    const outcome = await sendPortalPasswordReset(target, actorOf(access));
    revalidatePath(`/students/${target.studentId}`);
    return outcome.delivered
      ? { success: `Reset link emailed to ${outcome.email}. It works once, for an hour.` }
      : {
          success: `Reset requested for ${outcome.email}, but no email provider is configured, so it can't arrive. The link is deliberately not shown here — this account already works, and a link on a staff screen would be a way into it.`,
        };
  } catch (e) {
    return toFormState(e);
  }
}

export async function withdrawPortalAction(rawTarget: PortalTarget, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { access, target } = await gate(rawTarget, formData);
    const outcome = await withdrawPortalAccess(target, actorOf(access));
    revalidatePath(`/students/${target.studentId}`);
    return {
      success: outcome.loginDisabled
        ? "Portal access withdrawn. The login is disabled and any open session ends on its next page."
        : "Portal access withdrawn. The login stays active for the other roles it holds.",
    };
  } catch (e) {
    return toFormState(e);
  }
}
