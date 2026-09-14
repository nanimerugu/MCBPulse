import { withBranch } from "@/lib/branch-context";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, PageHeader, Select, inputClass } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadFilesAccess, param } from "@/modules/sis/access";
import { CLASSIFICATIONS, listFiles } from "@/modules/files/files.service";
import { ALLOWED_EXTENSIONS, formatBytes, MAX_FILE_BYTES } from "@/modules/files/validation";
import { formatDate } from "@/modules/sis/labels";
import { archiveFileAction, uploadFileAction } from "@/app/(app)/files/actions";

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadFilesAccess(param(sp, "branch"), "files.assets", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Files" />
        <AccessDenied result={result} permission="files.assets:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const [files, held] = await Promise.all([
    listFiles({ organizationId: ctx.organizationId, branchId: ctx.branch.id }),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
  ]);

  const hidden = { branchId: ctx.branch.id };
  const totalBytes = files.reduce((s, f) => s + f.sizeBytes, 0);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Files" description={`${files.length} file${files.length === 1 ? "" : "s"} · ${formatBytes(totalBytes)} stored`} />

      {held.has("files.assets:create") ? (
        <Card title="Upload">
          <ActionForm action={uploadFileAction} hidden={hidden} submitLabel="Upload" pendingLabel="Uploading…">
            <Field label="File" htmlFor="fl-file" hint={`Up to ${formatBytes(MAX_FILE_BYTES)}. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}.`}>
              <input id="fl-file" name="file" type="file" required className={inputClass} />
            </Field>
            <Field label="Classification" htmlFor="fl-class" hint="Recorded for a future retention policy. Nothing enforces it yet.">
              <Select id="fl-class" name="classification" defaultValue="internal">
                {CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          </ActionForm>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            HTML, SVG and scripts are refused: served from this origin they would run as you. Files are stored outside the web root — never under <code className="text-xs">public/</code>, which would serve them from this origin — and
            every download goes out as an attachment.
          </p>
        </Card>
      ) : null}

      <Card title="Stored files">
        {files.length === 0 ? (
          <EmptyState>Nothing uploaded yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {files.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <a href={withBranch(`/files/${f.id}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                    {f.fileName}
                  </a>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {formatBytes(f.sizeBytes)} · {f.ownerUser?.name ?? "unknown"} · {formatDate(f.createdAt)} ·{" "}
                    <span className="font-mono">{f.checksum.slice(0, 12)}…</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={f.classification === "confidential" ? "red" : f.classification === "public" ? "green" : "neutral"}>
                    {f.classification}
                  </Badge>
                  {held.has("files.assets:delete") ? (
                    <ActionForm action={archiveFileAction.bind(null, f.id)} hidden={hidden} submitLabel="Archive" variant="danger" inline />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          The checksum is verified on every read; bytes that don&apos;t match what was uploaded are refused rather than served. Archiving is a
          soft delete — a document attached to an application is evidence, so the bytes stay until there is a retention policy to purge by.
        </p>
      </Card>
    </div>
  );
}
