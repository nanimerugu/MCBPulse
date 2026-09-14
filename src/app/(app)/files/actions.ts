"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/lib/rbac";
import { actorOf, requireFilesAccessForAction, str, type ModuleAccess } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { SisError } from "@/modules/sis/students.service";
import { archiveFile, attachToApplicationDocument, uploadFile, type Classification, type FileScope, CLASSIFICATIONS } from "@/modules/files/files.service";
import { formatBytes, MAX_FILE_BYTES } from "@/modules/files/validation";

function toFormState(error: unknown): FormState {
  if (error instanceof SisError || error instanceof ForbiddenError) return { error: error.message };
  throw error;
}
function scopeOf(access: ModuleAccess): FileScope {
  return { organizationId: access.ctx.organizationId, branchId: access.ctx.branch.id };
}

/**
 * The upload path. The File is read into memory because the cap is 10MB —
 * streaming straight to storage matters at a larger cap and is what the
 * object-storage adapter would do.
 */
export async function uploadFileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireFilesAccessForAction(str(formData, "branchId"), "files.assets", "create");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a file" };
    // Checked before reading the body into memory, not after.
    if (file.size > MAX_FILE_BYTES) return { error: `That file is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_FILE_BYTES)}` };

    const classificationRaw = str(formData, "classification") ?? "internal";
    const classification = (CLASSIFICATIONS as readonly string[]).includes(classificationRaw)
      ? (classificationRaw as Classification)
      : "internal";

    const bytes = Buffer.from(await file.arrayBuffer());
    const { asset, deduplicated } = await uploadFile(
      { fileName: file.name, mimeType: file.type, bytes, classification },
      scopeOf(access),
      actorOf(access),
    );

    revalidatePath("/files");
    return {
      success: deduplicated
        ? `Already stored as "${asset.fileName}" — the identical file was reused rather than kept twice`
        : `Uploaded "${asset.fileName}" (${formatBytes(asset.sizeBytes)})`,
    };
  } catch (e) {
    return toFormState(e);
  }
}

export async function archiveFileAction(fileId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireFilesAccessForAction(str(formData, "branchId"), "files.assets", "delete");
    await archiveFile(fileId, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/files");
  return { success: "File archived — the bytes are kept, because a document attached to a record is evidence" };
}

/** Upload straight onto an application's document checklist. */
export async function uploadApplicationDocumentAction(documentId: string, applicationId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireFilesAccessForAction(str(formData, "branchId"), "files.assets", "create");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a file" };
    if (file.size > MAX_FILE_BYTES) return { error: `That file is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_FILE_BYTES)}` };

    const bytes = Buffer.from(await file.arrayBuffer());
    const { asset } = await uploadFile(
      { fileName: file.name, mimeType: file.type, bytes, classification: "confidential" },
      scopeOf(access),
      actorOf(access),
    );
    await attachToApplicationDocument(documentId, asset.id, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/admissions/leads`);
  revalidatePath(`/admissions`);
  return { success: "Document attached" };
}
