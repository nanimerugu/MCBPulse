import { Card, EmptyState, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadFinanceAccess, param } from "@/modules/sis/access";
import { listAccountsWithBalances, listRecentJournal } from "@/modules/finance/ledger.service";
import { formatMoney, toMinor } from "@/modules/finance/money";
import { formatDate } from "@/modules/sis/labels";

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadFinanceAccess(param(sp, "branch"), "finance.ledger", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Ledger" />
        <AccessDenied result={result} permission="finance.ledger:view" />
      </>
    );
  }
  const { ctx } = result.access;
  const [accounts, journal] = await Promise.all([listAccountsWithBalances(ctx.organizationId), listRecentJournal(ctx.organizationId)]);
  const totalDebit = accounts.reduce((s, a) => s + a.debitMinor, 0);
  const totalCredit = accounts.reduce((s, a) => s + a.creditMinor, 0);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Ledger"
        description="Organization-wide double-entry journal. Every payment, processed refund and paid payroll run posts a balanced entry."
      />

      <Card title="Trial balance">
        {accounts.length === 0 ? (
          <EmptyState>No accounts yet — the chart of accounts is created with the first payment.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="py-1 pr-4 font-medium">Code</th>
                <th className="py-1 pr-4 font-medium">Account</th>
                <th className="py-1 pr-4 font-medium">Type</th>
                <th className="py-1 pr-4 text-right font-medium">Debits</th>
                <th className="py-1 pr-4 text-right font-medium">Credits</th>
                <th className="py-1 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td className="py-1.5 pr-4 font-mono text-xs">{a.code}</td>
                  <td className="py-1.5 pr-4 text-zinc-900 dark:text-zinc-50">{a.name}</td>
                  <td className="py-1.5 pr-4 text-xs text-zinc-500">{a.type.toLowerCase()}</td>
                  <td className="py-1.5 pr-4 text-right font-mono text-xs">{formatMoney(a.debitMinor)}</td>
                  <td className="py-1.5 pr-4 text-right font-mono text-xs">{formatMoney(a.creditMinor)}</td>
                  <td className="py-1.5 text-right font-mono text-xs font-semibold">{formatMoney(a.balanceMinor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-zinc-300 text-xs dark:border-zinc-700">
              <tr>
                <td colSpan={3} className="py-1.5 pr-4 font-medium">
                  Totals {totalDebit === totalCredit ? "(balanced)" : "(UNBALANCED — investigate)"}
                </td>
                <td className="py-1.5 pr-4 text-right font-mono">{formatMoney(totalDebit)}</td>
                <td className="py-1.5 pr-4 text-right font-mono">{formatMoney(totalCredit)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </Card>

      <Card title={`Recent journal (${journal.length})`}>
        {journal.length === 0 ? (
          <EmptyState>No entries yet.</EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            {journal.map((e) => (
              <div key={e.id} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <p className="text-zinc-900 dark:text-zinc-50">
                  <span className="font-mono text-xs text-zinc-500">{formatDate(e.entryDate)}</span> · {e.description}
                </p>
                <ul className="mt-1 text-xs">
                  {e.lines.map((l) => (
                    <li key={l.id} className="flex justify-between font-mono">
                      <span>
                        {l.account.code} {l.account.name}
                      </span>
                      <span>
                        {toMinor(l.debit) ? `Dr ${formatMoney(toMinor(l.debit))}` : ""}
                        {toMinor(l.credit) ? `Cr ${formatMoney(toMinor(l.credit))}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
