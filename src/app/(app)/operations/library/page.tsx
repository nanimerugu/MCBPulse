import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadOpsAccess, param } from "@/modules/sis/access";
import { listLibraryItems, listOpenLoans } from "@/modules/operations/library.service";
import { daysOverdue, loanState, LOAN_STATE_LABELS } from "@/modules/operations/library";
import { formatDate } from "@/modules/sis/labels";
import { createLibraryItemAction, returnLibraryItemAction } from "@/app/(app)/operations/actions";

const TONES = { returned: "neutral", overdue: "red", due_today: "amber", on_loan: "green" } as const;

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadOpsAccess(param(sp, "branch"), "ops.library", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Library" />
        <AccessDenied result={result} permission="ops.library:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const search = param(sp, "q")?.trim() || undefined;

  const [items, loans, held] = await Promise.all([
    listLibraryItems({ organizationId: ctx.organizationId, branchId: ctx.branch.id }, search),
    listOpenLoans({ organizationId: ctx.organizationId, branchId: ctx.branch.id }),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
  ]);

  const hidden = { branchId: ctx.branch.id };
  const now = new Date();
  const totalCopies = items.reduce((s, i) => s + i.totalCopies, 0);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Library"
        description={`${items.length} title${items.length === 1 ? "" : "s"} · ${totalCopies} copies · ${loans.length} on loan`}
        actions={<LinkButton href={withBranch("/operations", ctx)}>Back to Operations</LinkButton>}
      />

      {held.has("ops.library:create") ? (
        <Card title="Add a title">
          <ActionForm action={createLibraryItemAction} hidden={hidden} submitLabel="Add title">
            <div className="flex flex-wrap gap-3">
              <Field label="Title" htmlFor="lb-title">
                <Input id="lb-title" name="title" required maxLength={200} placeholder="The Wind in the Willows" />
              </Field>
              <Field label="Author" htmlFor="lb-author">
                <Input id="lb-author" name="author" maxLength={120} placeholder="Kenneth Grahame" />
              </Field>
              <Field label="ISBN" htmlFor="lb-isbn">
                <Input id="lb-isbn" name="isbn" maxLength={20} />
              </Field>
              <Field label="Copies" htmlFor="lb-copies">
                <Input id="lb-copies" name="totalCopies" type="number" min={1} max={9999} defaultValue={1} />
              </Field>
            </div>
          </ActionForm>
        </Card>
      ) : null}

      <Card title="On loan">
        {loans.length === 0 ? (
          <EmptyState>Nothing is out.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {loans.map((l) => {
              const state = loanState(l, now);
              const late = daysOverdue(l, now);
              return (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <Link href={withBranch(`/operations/library/${l.libraryItemId}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                      {l.libraryItem.title}
                    </Link>
                    <p className="text-zinc-500 dark:text-zinc-400">
                      {l.student ? `${l.student.firstName} ${l.student.lastName}` : (l.staff?.user.name ?? "—")} · due {formatDate(l.dueAt)}
                      {late > 0 ? ` · ${late} day${late === 1 ? "" : "s"} late` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={TONES[state]}>{LOAN_STATE_LABELS[state].toLowerCase()}</Badge>
                    {held.has("ops.library:edit") ? (
                      <ActionForm action={returnLibraryItemAction.bind(null, l.id)} hidden={hidden} submitLabel="Return" inline />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Catalogue">
        <form className="mb-3 flex flex-wrap items-end gap-2" action={withBranch("/operations/library", ctx)}>
          <input type="hidden" name="branch" value={ctx.branch.id} />
          <Field label="Search" htmlFor="lb-q">
            <Input id="lb-q" name="q" defaultValue={search ?? ""} placeholder="Title, author or ISBN" />
          </Field>
          <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3.5 py-2 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-900">
            Search
          </button>
        </form>

        {items.length === 0 ? (
          <EmptyState>{search ? `Nothing matches "${search}".` : "The catalogue is empty."}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <tr>
                  <th className="py-2 pr-4 font-medium">Title</th>
                  <th className="py-2 pr-4 font-medium">Author</th>
                  <th className="py-2 pr-4 text-right font-medium">Available</th>
                  <th className="py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {items.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2 pr-4">
                      <Link href={withBranch(`/operations/library/${i.id}`, ctx)} className="font-medium hover:underline">
                        {i.title}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-zinc-500 dark:text-zinc-400">{i.author ?? "—"}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {i.availableCopies === 0 ? <span className="text-amber-600 dark:text-amber-400">all out</span> : i.availableCopies}
                    </td>
                    <td className="py-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{i.totalCopies}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
