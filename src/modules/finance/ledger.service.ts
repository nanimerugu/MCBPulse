import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { ACCOUNT_CODES, fromMinor, toMinor } from "@/modules/finance/money";

/**
 * Double-entry ledger (blueprint section 3 "double-entry-ready ledger
 * model"). Every successful payment and every processed refund posts a
 * balanced JournalEntry; nothing else writes to the journal in Phase 4.
 * The chart of accounts is minimal and seeded on first use per organization.
 */

const DEFAULT_ACCOUNTS: { code: string; name: string; type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" }[] = [
  { code: ACCOUNT_CODES.CASH, name: "Cash", type: "ASSET" },
  { code: ACCOUNT_CODES.BANK, name: "Bank", type: "ASSET" },
  { code: ACCOUNT_CODES.PAYROLL_DEDUCTIONS_PAYABLE, name: "Payroll deductions payable", type: "LIABILITY" },
  { code: ACCOUNT_CODES.FEE_INCOME, name: "Fee income", type: "INCOME" },
  { code: ACCOUNT_CODES.SALARY_EXPENSE, name: "Salaries and wages", type: "EXPENSE" },
  { code: ACCOUNT_CODES.EMPLOYER_CONTRIBUTIONS_EXPENSE, name: "Employer payroll contributions", type: "EXPENSE" },
];

type Tx = Prisma.TransactionClient;

export async function ensureChartOfAccounts(organizationId: string, tx: Tx | typeof db = db) {
  for (const a of DEFAULT_ACCOUNTS) {
    await tx.account.upsert({
      where: { organizationId_code: { organizationId, code: a.code } },
      create: { organizationId, code: a.code, name: a.name, type: a.type },
      update: {},
    });
  }
}

/**
 * Posts one balanced entry. Throws if debits != credits — the service layer
 * is where the blueprint's "lines must balance" invariant lives.
 */
export async function postJournalEntry(
  tx: Tx,
  args: {
    organizationId: string;
    entryDate: Date;
    description: string;
    createdByUserId: string;
    lines: { accountCode: string; debitMinor?: number; creditMinor?: number }[];
  },
) {
  const debits = args.lines.reduce((s, l) => s + (l.debitMinor ?? 0), 0);
  const credits = args.lines.reduce((s, l) => s + (l.creditMinor ?? 0), 0);
  if (debits !== credits) throw new Error(`Unbalanced journal entry: debits ${debits} != credits ${credits}`);

  const accounts = await tx.account.findMany({
    where: { organizationId: args.organizationId, code: { in: args.lines.map((l) => l.accountCode) }, deletedAt: null },
  });
  const byCode = new Map(accounts.map((a) => [a.code, a.id]));
  for (const l of args.lines) if (!byCode.has(l.accountCode)) throw new Error(`No account ${l.accountCode} — run ensureChartOfAccounts`);

  return tx.journalEntry.create({
    data: {
      organizationId: args.organizationId,
      entryDate: args.entryDate,
      description: args.description,
      createdByUserId: args.createdByUserId,
      postedAt: new Date(),
      lines: {
        create: args.lines.map((l) => ({
          accountId: byCode.get(l.accountCode)!,
          debit: fromMinor(l.debitMinor ?? 0),
          credit: fromMinor(l.creditMinor ?? 0),
        })),
      },
    },
  });
}

export async function listAccountsWithBalances(organizationId: string) {
  const accounts = await db.account.findMany({ where: { organizationId, deletedAt: null }, orderBy: { code: "asc" } });
  const sums = await db.journalLine.groupBy({
    by: ["accountId"],
    where: { account: { organizationId } },
    _sum: { debit: true, credit: true },
  });
  const byId = new Map(sums.map((s) => [s.accountId, { debit: toMinor(s._sum.debit ?? 0), credit: toMinor(s._sum.credit ?? 0) }]));
  return accounts.map((a) => {
    const s = byId.get(a.id) ?? { debit: 0, credit: 0 };
    // Assets/expenses carry debit balances; income/liabilities/equity credit balances.
    const balanceMinor = a.type === "ASSET" || a.type === "EXPENSE" ? s.debit - s.credit : s.credit - s.debit;
    return { ...a, debitMinor: s.debit, creditMinor: s.credit, balanceMinor };
  });
}

export async function listRecentJournal(organizationId: string, take = 30) {
  return db.journalEntry.findMany({
    where: { organizationId },
    include: { lines: { include: { account: true } } },
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
    take,
  });
}
