import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { checkUpload, describeProblem, storageKeyFor } from "@/modules/files/validation";
import { checksumOf, getFileStorage } from "@/modules/files/storage";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * Upload, list and read files. Every asset is pinned to an organization, and
 * every read re-asserts it — a file id alone is never enough to fetch bytes.
 *
 * `classification` records how sensitive a file is so a future retention or
 * export policy has something to act on. Nothing enforces it yet, which is
 * said plainly rather than implied by its presence.
 */

export interface FileScope {
  organizationId: string;
  branchId: string;
}

export const CLASSIFICATIONS = ["internal", "confidential", "public"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export async function uploadFile(
  input: { fileName: string; mimeType: string; bytes: Buffer; classification?: Classification; folderId?: string },
  scope: FileScope,
  actor: Actor,
) {
  const check = checkUpload({ fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.bytes.byteLength });
  if (!check.ok) throw new SisError(describeProblem(check.problem));

  if (input.folderId) {
    const folder = await db.fileFolder.findFirst({ where: { id: input.folderId, organizationId: scope.organizationId, deletedAt: null } });
    if (!folder) throw new SisError("Folder not found");
  }

  const id = randomUUID();
  const key = storageKeyFor(scope.organizationId, id, check.extension);
  const checksum = checksumOf(input.bytes);

  // An identical file already uploaded by this organization is reused rather
  // than stored twice — schools re-upload the same circular constantly.
  const existing = await db.fileAsset.findFirst({
    where: { organizationId: scope.organizationId, checksum, sizeBytes: input.bytes.byteLength, deletedAt: null },
  });
  if (existing) return { asset: existing, deduplicated: true };

  const stored = await getFileStorage().put(key, input.bytes);

  const asset = await db.fileAsset.create({
    data: {
      id,
      organizationId: scope.organizationId,
      folderId: input.folderId ?? null,
      ownerUserId: actor.userId,
      fileName: check.safeName,
      mimeType: input.mimeType || "application/octet-stream",
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      storageKey: stored.storageKey,
      classification: input.classification ?? "internal",
      versions: { create: { versionNumber: 1, storageKey: stored.storageKey, checksum: stored.checksum } },
    },
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "file.uploaded",
    resourceType: "file_asset",
    resourceId: asset.id,
    after: { fileName: check.safeName, sizeBytes: stored.sizeBytes, mimeType: input.mimeType, classification: asset.classification },
  });

  return { asset, deduplicated: false };
}

export async function listFiles(scope: FileScope, take = 100) {
  return db.fileAsset.findMany({
    where: { organizationId: scope.organizationId, deletedAt: null },
    include: { ownerUser: { select: { name: true } }, folder: true },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function getFileAsset(fileId: string, organizationId: string) {
  return db.fileAsset.findFirst({ where: { id: fileId, organizationId, deletedAt: null } });
}

/**
 * Reads bytes and verifies them against the checksum recorded at upload.
 * A mismatch means the store has been tampered with or has rotted, and is
 * refused — serving bytes we cannot vouch for is worse than an error.
 */
export async function readFileBytes(fileId: string, organizationId: string): Promise<{ asset: NonNullable<Awaited<ReturnType<typeof getFileAsset>>>; bytes: Buffer } | null> {
  const asset = await getFileAsset(fileId, organizationId);
  if (!asset) return null;

  const bytes = await getFileStorage().get(asset.storageKey);
  if (!bytes) return null;
  if (checksumOf(bytes) !== asset.checksum) {
    throw new SisError("That file failed its integrity check and was not served");
  }
  return { asset, bytes };
}

/**
 * Soft delete, and the bytes stay. A file referenced by an application
 * document or a submission is evidence; removing the blob would leave a row
 * pointing at nothing. A retention job can purge properly once there is a
 * retention policy to purge by.
 */
export async function archiveFile(fileId: string, scope: FileScope, actor: Actor) {
  const asset = await getFileAsset(fileId, scope.organizationId);
  if (!asset) throw new SisError("File not found");

  await db.fileAsset.update({ where: { id: fileId }, data: { deletedAt: new Date() } });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "file.archived",
    resourceType: "file_asset",
    resourceId: fileId,
    after: { fileName: asset.fileName },
  });
}

/** Attach an already-uploaded file to an application's document checklist. */
export async function attachToApplicationDocument(documentId: string, fileId: string, scope: FileScope, actor: Actor) {
  const doc = await db.applicationDocument.findFirst({
    where: { id: documentId, application: { lead: { branchId: scope.branchId } } },
    include: { application: true },
  });
  if (!doc) throw new SisError("Document not found");

  const asset = await getFileAsset(fileId, scope.organizationId);
  if (!asset) throw new SisError("File not found");

  await db.applicationDocument.update({ where: { id: documentId }, data: { fileAssetId: fileId } });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "application_document.attached",
    resourceType: "application",
    resourceId: doc.applicationId,
    after: { documentId, fileId, fileName: asset.fileName },
  });
}
