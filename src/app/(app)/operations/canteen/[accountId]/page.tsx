import { notFound } from "next/navigation";
import { withBranch } from "@/lib/branch-context";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadOpsAccess, param } from "@/modules/sis/access";
import { getAccount, listMenu } from "@/modules/canteen/canteen.service";
import { isLowBalance, TRANSACTION_LABELS } from "@/modules/canteen/wallet";
import { formatMoney, toMinor } from "@/modules/finance/money";
import { formatDate } from "@/modules/sis/labels";
import { sellAction, setActiveAction, topUpAction } from "@/app/(app)/operations/canteen/actions";

export default async function WalletPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ accountId }, sp] = await Promise.all([params, searchParams]);
  const result = await loadOpsAccess(param(sp, "branch"), "ops.canteen", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Wallet" />
        <AccessDenied result={result} permission="ops.canteen:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const scope = { organizationId: ctx.organizationId, branchId: ctx.branch.id };

  const [account, menu, held] = await Promise.all([getAccount(accountId, scope), listMenu(scope), heldPermissionKeys(viewer.userId, ctx.organizationId)]);
  if (!account) notFound();

  const hidden = { branchId: ctx.branch.id };
  const balance = toMinor(account.balance);
  const canPay = held.has("ops.canteen:pay");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={`${account.student.firstName} ${account.student.lastName}`}
        description={
          account.student.currentSection
            ? `${account.student.currentSection.grade.name}/${account.student.currentSection.name} · ${account.student.admissionNumber}`
            : account.student.admissionNumber
        }
        actions={<LinkButton href={withBranch("/operations/canteen", ctx)}>All wallets</LinkButton>}
      />

      <Card title="Balance">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-3xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{formatMoney(balance)}</p>
          {!account.active ? <Badge tone="red">frozen</Badge> : isLowBalance(balance) ? <Badge tone="amber">low</Badge> : null}
        </div>
        {canPay ? (
          <div className="mt-3">
            <ActionForm
              action={setActiveAction.bind(null, accountId, !account.active)}
              hidden={hidden}
              submitLabel={account.active ? "Freeze wallet" : "Unfreeze wallet"}
              variant={account.active ? "danger" : "secondary"}
              inline
            />
          </div>
        ) : null}
      </Card>

      {canPay ? (
        <>
          <Card title="Top up">
            <ActionForm action={topUpAction.bind(null, accountId)} hidden={hidden} submitLabel="Top up" inline>
              <Field label="Amount" htmlFor="tu-amount">
                <Input id="tu-amount" name="amount" inputMode="decimal" placeholder="500.00" required />
              </Field>
              <Field label="Note" htmlFor="tu-note">
                <Input id="tu-note" name="note" maxLength={200} placeholder="Cash at the office" />
              </Field>
            </ActionForm>
          </Card>

          <Card title="Till">
            {menu.length === 0 ? (
              <EmptyState>Nothing on the menu yet.</EmptyState>
            ) : (
              <>
                <ActionForm action={sellAction.bind(null, accountId)} hidden={hidden} submitLabel="Take payment">
                  <ul className="flex flex-col gap-2">
                    {menu.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-zinc-800 dark:text-zinc-200">
                          {m.name} <span className="text-xs text-zinc-500 dark:text-zinc-400">{formatMoney(toMinor(m.price))}</span>
                        </span>
                        <input
                          type="number"
                          name={`qty_${m.id}`}
                          min={0}
                          max={20}
                          defaultValue={0}
                          aria-label={`Quantity of ${m.name}`}
                          className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        />
                      </li>
                    ))}
                  </ul>
                </ActionForm>
                <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                  The basket sends item ids and quantities only. Prices are read from the menu on the server, so a tampered form can&apos;t
                  sell a {formatMoney(toMinor(menu[0]!.price))} item for a rupee.
                </p>
              </>
            )}
          </Card>
        </>
      ) : null}

      <Card title="Ledger">
        {account.transactions.length === 0 ? (
          <EmptyState>Nothing recorded yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {account.transactions.map((t) => {
              const amount = toMinor(t.amount);
              return (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">{TRANSACTION_LABELS[t.kind]}</p>
                    {t.note ? <p className="text-xs text-zinc-500 dark:text-zinc-400">{t.note}</p> : null}
                  </div>
                  <span className="flex items-center gap-3 tabular-nums text-zinc-500 dark:text-zinc-400">
                    <span className={amount < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}>
                      {amount > 0 ? "+" : ""}
                      {formatMoney(amount)}
                    </span>
                    <span>→ {formatMoney(toMinor(t.balanceAfter))}</span>
                    <span>{formatDate(t.createdAt)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {account.sales.length > 0 ? (
        <Card title="Recent purchases">
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {account.sales.map((s) => (
              <li key={s.id} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {s.lines.map((l) => `${l.quantity}× ${l.canteenItem.name}`).join(", ")}
                  </span>
                  <span className="tabular-nums text-zinc-900 dark:text-zinc-50">{formatMoney(toMinor(s.total))}</span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{formatDate(s.createdAt)}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Each line keeps the price it was sold at — a later menu change never rewrites what a family was charged.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
