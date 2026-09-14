import { recordAuditEvent } from "@/lib/audit";
import { loadFilesAccess } from "@/modules/sis/access";
import { readFileBytes } from "@/modules/files/files.service";
import { attachmentDisposition } from "@/modules/files/validation";
import { SisError } from "@/modules/sis/students.service";

/**
 * The only way bytes leave the store.
 *
 * Three things make this safe, and all three matter:
 *  - the organization is re-asserted, so a file id alone fetches nothing;
 *  - `Content-Disposition: attachment` always, never inline, so an uploaded
 *    file cannot render in our origin even if the allow-list is one day
 *    widened by mistake;
 *  - `Content-Type: application/octet-stream` with nosniff, for the same
 *    reason — we do not hand the browser a type it might decide to execute.
 *
 * Downloads are audited: a bulk pull of a school's documents should leave a
 * trail as much as a CSV export does.
 */
export async function GET(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const url = new URL(request.url);

  const result = await loadFilesAccess(url.searchParams.get("branch") ?? undefined, "files.assets", "view");
  if (!result.ok) return new Response("Forbidden", { status: 403 });
  const { viewer, ctx } = result.access;

  let found;
  try {
    found = await readFileBytes(fileId, ctx.organizationId);
  } catch (e) {
    if (e instanceof SisError) return new Response(e.message, { status: 409 });
    throw e;
  }
  if (!found) return new Response("Not found", { status: 404 });

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorUserId: viewer.userId,
    action: "file.downloaded",
    resourceType: "file_asset",
    resourceId: fileId,
    after: { fileName: found.asset.fileName, sizeBytes: found.asset.sizeBytes },
  });

  return new Response(new Uint8Array(found.bytes), {
    headers: {
      // Deliberately NOT the stored mimeType: never hand the browser a type
      // it might choose to render.
      "Content-Type": "application/octet-stream",
      "Content-Disposition": attachmentDisposition(found.asset.fileName),
      "Content-Length": String(found.asset.sizeBytes),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
