import { notFound } from "next/navigation";
import { withBranch } from "@/lib/branch-context";
import { db } from "@/lib/db";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, DescriptionList, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadOpsAccess, param } from "@/modules/sis/access";
import { getLibraryItem } from "@/modules/operations/library.service";
import { DEFAULT_BORROW_LIMIT, DEFAULT_LOAN_DAYS, daysOverdue, loanState, LOAN_STATE_LABELS } from "@/modules/operations/library";
import { formatDate } from "@/modules/sis/labels";
import { issueLibraryItemAction, returnLibraryItemAction, setTotalCopiesAction } from "@/app/(app)/operations/actions";

const TONES = { returned: "neutral", overdue: "red", due_today: "amber", on_loan: "green" } as const;

export default async function LibraryItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ itemId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ itemId }, sp] = await Promise.all([params, searchParams]);
  const result = await loadOpsAccess(param(sp, "branch"), "ops.library", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Title" />
        <AccessDenied result={result} permission="ops.library:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;

  const [item, held] = await Promise.all([
    getLibraryItem(itemId, { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
  ]);
  if (!item) notFound();

  const canEdit = held.has("ops.library:edit");
  const [students, staff] = canEdit
    ? await Promise.all([
        db.student.findMany({
          where: { organizationId: ctx.organizationId, deletedAt: null, status: "ENROLLED" },
          include: { currentSection: { include: { grade: true } } },
          orderBy: [{ firstName: "asc" }],
          take: 300,
        }),
        db.staff.findMany({
          where: { organizationId: ctx.organizationId, branchId: ctx.branch.id, deletedAt: null, exitDate: null },
          include: { user: true },
          orderBy: { employeeCode: "asc" },
        }),
      ])
    : [[], []];

  const hidden = { branchId: ctx.branch.id };
  const now = new Date();
  const open = item.issues.filter((i) => !i.returnedAt);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={item.title}
        description={item.author ?? undefined}
        actions={<LinkButton href={withBranch("/operations/library", ctx)}>Back to library</LinkButton>}
      />

      <Card title="Title">
        <DescriptionList
          items={[
            { label: "Author", value: item.author ?? "—" },
            { label: "ISBN", value: item.isbn ?? "—" },
            { label: "Total copies", value: String(item.totalCopies) },
            {
              label: "Available",
              value: item.availableCopies === 0 ? <Badge tone="amber">all out</Badge> : String(item.availableCopies),
            },
          ]}
        />
      </Card>

      {canEdit ? (
        <>
          <Card title="Issue a copy">
            {item.availableCopies === 0 ? (
              <EmptyState>Every copy is out. A return frees one.</EmptyState>
            ) : (
              <ActionForm action={issueLibraryItemAction.bind(null, itemId)} hidden={hidden} submitLabel="Issue">
                <div className="flex flex-wrap gap-3">
                  <Field label="Borrower" htmlFor="lb-borrower" hint={`Limit ${DEFAULT_BORROW_LIMIT} books per borrower`}>
                    <Select id="lb-borrower" name="borrower" required defaultValue="">
                      <option value="" disabled>
                        Choose…
                      </option>
                      <optgroup label="Students">
                        {students.map((s) => (
                          <option key={s.id} value={`student:${s.id}`}>
                            {s.firstName} {s.lastName}
                            {s.currentSection ? ` (${s.currentSection.grade.name}/${s.currentSection.name})` : ""}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Staff">
                        {staff.map((s) => (
                          <option key={s.id} value={`staff:${s.id}`}>
                            {s.user.name} ({s.employeeCode})
                          </option>
                        ))}
                      </optgroup>
                    </Select>
                  </Field>
                  <Field label="Loan days" htmlFor="lb-days">
                    <Input id="lb-days" name="loanDays" type="number" min={1} max={90} defaultValue={DEFAULT_LOAN_DAYS} />
                  </Field>
                </div>
              </ActionForm>
            )}
          </Card>

          <Card title="Copies held">
            <ActionForm action={setTotalCopiesAction.bind(null, itemId)} hidden={hidden} submitLabel="Update" inline>
              <Field label="Total copies" htmlFor="lb-total" hint="Availability is recomputed from what is actually on loan.">
                <Input id="lb-total" name="totalCopies" type="number" min={0} max={9999} defaultValue={item.totalCopies} />
              </Field>
            </ActionForm>
          </Card>
        </>
      ) : null}

      <Card title={`Loan history · ${open.length} out`}>
        {item.issues.length === 0 ? (
          <EmptyState>This title has never been issued.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {item.issues.map((i) => {
              const state = loanState(i, now);
              const late = daysOverdue(i, now);
              return (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">
                      {i.student ? `${i.student.firstName} ${i.student.lastName}` : (i.staff?.user.name ?? "—")}
                    </p>
                    <p className="text-zinc-500 dark:text-zinc-400">
                      Issued {formatDate(i.issuedAt)} · due {formatDate(i.dueAt)}
                      {i.returnedAt ? ` · returned ${formatDate(i.returnedAt)}` : ""}
                      {late > 0 ? ` · ${late} day${late === 1 ? "" : "s"} late` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={TONES[state]}>{LOAN_STATE_LABELS[state].toLowerCase()}</Badge>
                    {canEdit && !i.returnedAt ? (
                      <ActionForm action={returnLibraryItemAction.bind(null, i.id)} hidden={hidden} submitLabel="Return" inline />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
