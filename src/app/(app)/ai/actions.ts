"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError } from "@/lib/rbac";
import { db } from "@/lib/db";
import { actorOf, requireAiAccessForAction, str } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { fieldErrors } from "@/modules/sis/schemas";
import { SisError } from "@/modules/sis/students.service";
import { capabilityFor } from "@/modules/ai/capabilities";
import { copilotFigures, runCapability } from "@/modules/ai/gateway.service";

/**
 * Every name the redactor should recognise at this branch: students, and the
 * guardians who write in. Full names first so "Priya Rao" is consumed as one
 * unit before a bare "Rao" can be.
 */
async function rosterNames(organizationId: string, branchId: string): Promise<string[]> {
  const [students, guardians] = await Promise.all([
    db.student.findMany({
      where: { organizationId, branchId, deletedAt: null },
      select: { firstName: true, lastName: true },
      take: 1000,
    }),
    db.guardian.findMany({
      where: { deletedAt: null, studentLinks: { some: { student: { organizationId, branchId } } } },
      select: { firstName: true, lastName: true },
      take: 1000,
    }),
  ]);
  const names = new Set<string>();
  for (const p of [...students, ...guardians]) {
    names.add(`${p.firstName} ${p.lastName}`.trim());
    names.add(p.firstName);
    names.add(p.lastName);
  }
  return [...names].filter((n) => n.length > 2);
}

function toFormState(error: unknown): FormState {
  if (error instanceof SisError || error instanceof ForbiddenError) return { error: error.message };
  throw error;
}
function values(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

const schema = z.object({
  capability: z.string().min(1, "Choose what you want help with"),
  task: z.string().trim().min(1, "Say what you need").max(8000),
});

/**
 * One action for every capability. The gateway does the permission check
 * against the capability's OWN requirement, so this action's own gate is
 * only "may you open the AI console at all".
 */
export async function runCapabilityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireAiAccessForAction(str(formData, "branchId"), "ai.console", "view");
    const parsed = schema.safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

    const capability = capabilityFor(parsed.data.capability);
    if (!capability) return { error: "That capability is not available" };

    const scope = { organizationId: access.ctx.organizationId, branchId: access.ctx.branch.id };

    // Only the copilot reads school data, and only aggregates. Nothing here
    // can be talked into widening that by what the user typed.
    const schoolData = capability.key === "SCHOOL_COPILOT" ? await copilotFigures(scope) : undefined;

    // Pattern-matching catches phone numbers, emails and admission codes, but
    // a name is only a name if you know the names. The likeliest leak in
    // "improve this note" is a pasted student or parent name, so the roster
    // for this branch is supplied as the redaction vocabulary. It is used to
    // REMOVE names before sending, never to send them.
    const knownNames = await rosterNames(scope.organizationId, scope.branchId);

    const result = await runCapability(
      { capability: capability.key, task: parsed.data.task, schoolData, knownNames },
      scope,
      actorOf(access),
    );

    // Store the answer so the page can render it after the revalidate rather
    // than smuggling it through form state. This one keeps the restored
    // names: it is the requester's own result, shown only back to them
    // (/ai filters by userId), and it is the thing they asked for.
    await db.aiGeneration.update({ where: { id: result.generationId }, data: { outputSummary: result.text.slice(0, 4000) } });

    revalidatePath("/ai");
    const notes = [
      result.redactions > 0 ? `${result.redactions} identifier${result.redactions === 1 ? "" : "s"} redacted before sending` : null,
      result.injectionSuspected ? "the text looked like it was addressing the model — it was fenced as data" : null,
      !result.generated ? "no provider is configured, so nothing was generated" : null,
    ].filter(Boolean);
    return { success: notes.length > 0 ? `Done — ${notes.join("; ")}.` : "Done." };
  } catch (e) {
    return toFormState(e);
  }
}
