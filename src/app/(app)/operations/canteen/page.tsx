import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { db } from "@/lib/db";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadOpsAccess, param } from "@/modules/sis/access";
import { listAccounts, listMenu } from "@/modules/canteen/canteen.service";
import { isLowBalance } from "@/modules/canteen/wallet";
import { formatMoney, toMinor } from "@/modules/finance/money";
import { addMenuItemAction, openAccountAction } from "@/app/(app)/operations/canteen/actions";

export default async function CanteenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadOpsAccess(param(sp, "branch"), "ops.canteen", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Canteen" />
        <AccessDenied result={result} permission="ops.canteen:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const scope = { organizationId: ctx.organizationId, branchId: ctx.branch.id };

  const [menu, accounts, held, students] = await Promise.all([
    listMenu(scope),
    listAccounts(scope),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
    db.student.findMany({
      where: { organizationId: ctx.organizationId, branchId: ctx.branch.id, deletedAt: null, status: "ENROLLED", canteenAccount: null },
      include: { currentSection: { include: { grade: true } } },
      orderBy: { firstName: "asc" },
      take: 300,
    }),
  ]);

  const hidden = { branchId: ctx.branch.id };
  const float = accounts.reduce((s, a) => s + toMinor(a.balance), 0);
  const low = accounts.filter((a) => isLowBalance(toMinor(a.balance))).length;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Canteen"
        description={`${accounts.length} wallet${accounts.length === 1 ? "" : "s"} · ${formatMoney(float)} held${low > 0 ? ` · ${low} low` : ""}`}
        actions={<LinkButton href={withBranch("/operations", ctx)}>Back to Operations</LinkButton>}
      />

      <div className="rounded-md border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-zinc-600 dark:text-zinc-400">
          Canteen money is a <strong>prepaid float</strong>, deliberately outside the fee ledger and the trial balance — it is money a
          family has lent the school, not revenue recognised against an invoice. A wallet can never go negative: a canteen is not a credit
          facility, and a child who has run out should be told at the till rather than discover a debt at the end of term.
        </p>
      </div>

      {held.has("ops.canteen:configure") ? (
        <Card title="Menu">
          <ActionForm action={addMenuItemAction} hidden={hidden} submitLabel="Add item" inline>
            <Field label="Item" htmlFor="cn-name">
              <Input id="cn-name" name="name" required maxLength={80} placeholder="Vegetable sandwich" />
            </Field>
            <Field label="Price" htmlFor="cn-price">
              <Input id="cn-price" name="price" inputMode="decimal" placeholder="40.00" />
            </Field>
          </ActionForm>
          {menu.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {menu.map((m) => (
                <li key={m.id} className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {m.name} · {formatMoney(toMinor(m.price))}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {held.has("ops.canteen:pay") && students.length > 0 ? (
        <Card title="Open a wallet">
          <ActionForm action={openAccountAction} hidden={hidden} submitLabel="Open wallet" inline>
            <Field label="Student" htmlFor="cn-student" hint="Only students without a wallet are listed.">
              <Select id="cn-student" name="studentId" required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.firstName} {s.lastName}
                    {s.currentSection ? ` (${s.currentSection.grade.name}/${s.currentSection.name})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </ActionForm>
        </Card>
      ) : null}

      <Card title="Wallets">
        {accounts.length === 0 ? (
          <EmptyState>No wallets yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {accounts.map((a) => {
              const balance = toMinor(a.balance);
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                  <Link href={withBranch(`/operations/canteen/${a.id}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                    {a.student.firstName} {a.student.lastName}
                    {a.student.currentSection ? (
                      <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                        {a.student.currentSection.grade.name}/{a.student.currentSection.name}
                      </span>
                    ) : null}
                  </Link>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums text-zinc-900 dark:text-zinc-50">{formatMoney(balance)}</span>
                    {!a.active ? <Badge tone="red">frozen</Badge> : isLowBalance(balance) ? <Badge tone="amber">low</Badge> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
