import { authorize } from "@/lib/rbac";
import { db } from "@/lib/db";
import { Button, Card, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadFinanceAccess, param } from "@/modules/sis/access";
import { listFeeHeads, listFeeStructures } from "@/modules/finance/fees.service";
import { formatMoney } from "@/modules/finance/money";
import { addLineAction, createFeeHeadAction, createFeeStructureAction, removeLineAction } from "@/app/(app)/finance/actions";

export default async function FeeStructuresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadFinanceAccess(param(sp, "branch"), "finance.fee_structures", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Fee structures" />
        <AccessDenied result={result} permission="finance.fee_structures:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const [heads, structures, grades, canConfigure] = await Promise.all([
    listFeeHeads(ctx.organizationId),
    ctx.academicYear ? listFeeStructures(ctx.branch.id, ctx.academicYear.id) : Promise.resolve([]),
    db.grade.findMany({ where: { branchId: ctx.branch.id, deletedAt: null }, orderBy: { sequence: "asc" } }),
    authorize(viewer.userId, "finance.fee_structures", "configure", { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
  ]);
  const hidden = { branchId: ctx.branch.id };

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader title="Fee structures" description={`${ctx.branch.name} · ${ctx.academicYear?.name ?? "no current academic year"}`} />

      <Card title={`Fee heads (${heads.length})`}>
        {heads.length === 0 ? (
          <EmptyState>No fee heads yet — e.g. Tuition fee, Transport fee, Books &amp; uniform.</EmptyState>
        ) : (
          <ul className="flex flex-wrap gap-2 text-sm">
            {heads.map((h) => (
              <li key={h.id} className="rounded-full bg-zinc-100 px-3 py-1 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                {h.name}
              </li>
            ))}
          </ul>
        )}
        {canConfigure ? (
          <div className="mt-4">
            <ActionForm action={createFeeHeadAction} hidden={hidden} submitLabel="Add fee head" inline>
              <Input name="name" placeholder="e.g. Laboratory fee" required className="w-56" aria-label="Fee head name" />
            </ActionForm>
          </div>
        ) : null}
      </Card>

      <Card title={`Structures for ${ctx.academicYear?.name ?? "—"} (${structures.length})`}>
        {structures.length === 0 ? <EmptyState>No fee structures for this year yet.</EmptyState> : null}
        <div className="flex flex-col gap-4">
          {structures.map((s) => (
            <div key={s.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-zinc-900 dark:text-zinc-50">
                  {s.name} <span className="text-sm text-zinc-500 dark:text-zinc-400">· {s.grade?.name ?? "any grade"}</span>
                </p>
                <p className="text-sm text-zinc-700 dark:text-zinc-200">
                  Total <span className="font-semibold">{formatMoney(s.totalMinor)}</span>
                  <span className="ml-2 text-xs text-zinc-500">
                    · {s._count.invoices} invoice{s._count.invoices === 1 ? "" : "s"}
                  </span>
                </p>
              </div>
              {s.lines.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No lines yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                  {s.lines.map((l) => (
                    <li key={l.id} className="flex items-center justify-between py-1.5">
                      <span className="text-zinc-700 dark:text-zinc-200">{l.feeHead.name}</span>
                      <span className="flex items-center gap-3">
                        <span className="font-mono text-xs">{formatMoney(Number(l.amount) * 100)}</span>
                        {canConfigure && s._count.invoices === 0 ? (
                          <form action={removeLineAction}>
                            <input type="hidden" name="branchId" value={ctx.branch.id} />
                            <input type="hidden" name="lineId" value={l.id} />
                            <Button type="submit" variant="danger" className="!px-2 !py-0.5 text-xs">
                              Remove
                            </Button>
                          </form>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {canConfigure && s._count.invoices === 0 && heads.length > 0 ? (
                <div className="mt-3">
                  <ActionForm action={addLineAction.bind(null, s.id)} hidden={hidden} submitLabel="Set line" inline>
                    <Select name="feeHeadId" required defaultValue={heads[0].id} className="w-48" aria-label="Fee head">
                      {heads.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name}
                        </option>
                      ))}
                    </Select>
                    <Input name="amount" placeholder="Amount e.g. 25000" required className="w-36" aria-label="Amount" inputMode="decimal" />
                  </ActionForm>
                </div>
              ) : s._count.invoices > 0 ? (
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Locked: invoices have been raised from this structure. Create a new structure to change amounts.</p>
              ) : null}
            </div>
          ))}
        </div>

        {canConfigure && ctx.academicYear ? (
          <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">New structure</h3>
            <ActionForm action={createFeeStructureAction} hidden={hidden} submitLabel="Create structure" inline>
              <Field label="Name" htmlFor="fs-name">
                <Input id="fs-name" name="name" placeholder={`e.g. Grade 6 — Annual ${ctx.academicYear.name}`} required className="w-72" />
              </Field>
              <Field label="Grade" htmlFor="fs-grade">
                <Select id="fs-grade" name="gradeId" defaultValue="" className="w-40">
                  <option value="">Any grade</option>
                  {grades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </ActionForm>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
