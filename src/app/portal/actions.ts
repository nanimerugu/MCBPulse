"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/lib/rbac";
import type { FormState } from "@/modules/sis/form-state";
import { SisError } from "@/modules/sis/students.service";
import { getPortalScope, studentInScope } from "@/modules/portal/scope";
import { submitOwnWork } from "@/modules/portal/submissions.service";
import { formatBytes, MAX_FILE_BYTES } from "@/modules/files/validation";

function toFormState(error: unknown): FormState {
  if (error instanceof SisError || error instanceof ForbiddenError) return { error: error.message };
  throw error;
}

/**
 * The portal's only write.
 *
 * There is no studentId parameter: the student comes from the signed-in
 * user's own record. A parent reaching this action is refused by kind, not
 * by a filter — handing in work is the student's to do.
 */
export async function submitWorkAction(assignmentId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  let outcome: { late: boolean; replaced: boolean };
  try {
    const result = await getPortalScope();
    if (!result.ok) return { error: "Your login isn't linked to a student record" };
    const { scope } = result;
    if (scope.kind !== "student") return { error: "Only the student can hand in their own work" };

    const studentId = studentInScope(scope, undefined);
    if (!studentId) return { error: "Your login isn't linked to a student record" };

    const file = formData.get("file");
    let filePayload: { fileName: string; mimeType: string; bytes: Buffer } | undefined;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_FILE_BYTES) return { error: `That file is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_FILE_BYTES)}` };
      filePayload = { fileName: file.name, mimeType: file.type, bytes: Buffer.from(await file.arrayBuffer()) };
    }

    const responseText = formData.get("responseText");
    outcome = await submitOwnWork(
      { assignmentId, responseText: typeof responseText === "string" ? responseText : undefined, file: filePayload },
      scope,
      studentId,
    );
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/portal/work");
  const what = outcome.replaced ? "Replaced" : "Handed in";
  return { success: outcome.late ? `${what} — marked late, your teacher will decide what that means` : `${what}.` };
}
