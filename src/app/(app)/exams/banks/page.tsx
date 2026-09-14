import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { db } from "@/lib/db";
import { heldPermissionKeys } from "@/lib/rbac";
import { Card, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadExamsAccess, param } from "@/modules/sis/access";
import { listBanks } from "@/modules/examcell/examcell.service";
import { createBankAction } from "@/app/(app)/exams/actions";

export default async function BanksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadExamsAccess(param(sp, "branch"), "exams.banks", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Question banks" />
        <AccessDenied result={result} permission="exams.banks:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const [banks, held, subjects] = await Promise.all([
    listBanks({ organizationId: ctx.organizationId, branchId: ctx.branch.id }),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
    db.subject.findMany({ where: { organizationId: ctx.organizationId, deletedAt: null }, orderBy: { name: "asc" } }),
  ]);
  const hidden = { branchId: ctx.branch.id };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Question banks"
        description="Questions live here once and are drawn onto papers. Editing a question never changes a paper already sat."
        actions={<LinkButton href={withBranch("/exams", ctx)}>Back to exams</LinkButton>}
      />

      {held.has("exams.banks:create") && subjects.length > 0 ? (
        <Card title="New bank">
          <ActionForm action={createBankAction} hidden={hidden} submitLabel="Create bank" inline>
            <Field label="Subject" htmlFor="qb-subject">
              <Select id="qb-subject" name="subjectId" required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Name" htmlFor="qb-name">
              <Input id="qb-name" name="name" required maxLength={80} placeholder="Fractions — Grade 5" />
            </Field>
          </ActionForm>
        </Card>
      ) : null}

      <Card title="Banks">
        {banks.length === 0 ? (
          <EmptyState>No question banks yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {banks.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <Link href={withBranch(`/exams/banks/${b.id}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                  {b.name}
                </Link>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {b.subject.name} · {b._count.questions} question{b._count.questions === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
