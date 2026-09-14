"use client";

import { useActionState } from "react";
import { Badge, Button, ErrorBanner, Field, Input } from "@/components/ui";
import type { ImportFormState } from "@/app/(app)/students/actions";

export function ImportForm({
  previewAction,
  commitAction,
  branchId,
}: {
  previewAction: (prev: ImportFormState, fd: FormData) => Promise<ImportFormState>;
  commitAction: (prev: ImportFormState, fd: FormData) => Promise<ImportFormState>;
  branchId: string;
}) {
  const [previewState, doPreview, previewing] = useActionState(previewAction, undefined);
  const [commitState, doCommit, committing] = useActionState(commitAction, undefined);
  const preview = previewState?.preview;

  return (
    <div className="flex flex-col gap-6">
      <form action={doPreview} className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <input type="hidden" name="branchId" value={branchId} />
        <ErrorBanner message={previewState?.error} />
        <Field label="CSV file" htmlFor="file" hint="UTF-8, first row is the header. Up to 2 MB / 2,000 rows.">
          <Input id="file" name="file" type="file" accept=".csv,text/csv" required />
        </Field>
        <div>
          <Button type="submit" disabled={previewing}>
            {previewing ? "Checking…" : "Check file"}
          </Button>
        </div>
      </form>

      {preview ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium text-zinc-900 dark:text-zinc-50">{preview.fileName}</span>
            <Badge tone="green">{preview.validCount} ready</Badge>
            {preview.errorCount > 0 ? <Badge tone="red">{preview.errorCount} with errors</Badge> : null}
            {preview.tooManyRows ? <Badge tone="amber">Truncated to 2,000 rows</Badge> : null}
          </div>

          {preview.missingRequired.length > 0 ? (
            <ErrorBanner message={`Missing required column(s): ${preview.missingRequired.join(", ")}. Download the template to see the expected headers.`} />
          ) : null}

          <details className="text-sm">
            <summary className="cursor-pointer text-zinc-600 dark:text-zinc-300">How your columns were read</summary>
            <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {Object.entries(preview.columnMap).map(([header, canonical]) => (
                <li key={header} className="text-xs">
                  <span className="font-mono">{header}</span> →{" "}
                  {canonical ? <span className="font-mono text-emerald-700 dark:text-emerald-300">{canonical}</span> : <span className="text-zinc-400">ignored</span>}
                </li>
              ))}
            </ul>
          </details>

          <div className="max-h-96 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-zinc-50 uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Admission no.</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {preview.rows.map((r) => (
                  <tr key={r.rowNumber} className={r.errors.length ? "bg-red-50/60 dark:bg-red-950/20" : ""}>
                    <td className="px-3 py-1.5 text-zinc-500">{r.rowNumber}</td>
                    <td className="px-3 py-1.5 font-mono">{r.parsed?.admissionNumber ?? Object.values(r.raw)[0]}</td>
                    <td className="px-3 py-1.5">{r.parsed ? `${r.parsed.firstName} ${r.parsed.lastName}` : "—"}</td>
                    <td className="px-3 py-1.5">
                      {r.errors.length === 0 ? (
                        <span className="text-emerald-700 dark:text-emerald-300">OK{r.parsed?.sectionId ? " · will be enrolled" : " · enquiry"}</span>
                      ) : (
                        <ul className="list-disc pl-4 text-red-700 dark:text-red-300">
                          {r.errors.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={doCommit} className="flex flex-col gap-3">
            <input type="hidden" name="branchId" value={branchId} />
            <input type="hidden" name="csvText" value={preview.csvText} />
            <ErrorBanner message={commitState?.error} />
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={committing || preview.errorCount > 0 || preview.validCount === 0 || preview.tooManyRows}>
                {committing ? "Importing…" : `Import ${preview.validCount} student${preview.validCount === 1 ? "" : "s"}`}
              </Button>
              {preview.errorCount > 0 ? (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Fix the rows above and check the file again — imports are all-or-nothing.</span>
              ) : null}
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
