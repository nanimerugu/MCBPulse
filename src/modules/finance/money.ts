import type { InvoiceStatus, PaymentMethod } from "@/generated/prisma/enums";

/**
 * Money arithmetic for Finance, done in integer minor units (paise) so that
 * "₹1,234.50 minus ₹0.10, three times" can never drift the way floats do
 * (blueprint section 3: "double-entry-ready ledger model"; section 9 names
 * invoices as high-conflict records). The database column is Decimal(12,2);
 * these helpers are the only bridge between it and the application.
 */

export type DecimalLike = string | number | { toString(): string };

/** "1234.50" | 1234.5 | Prisma Decimal -> 123450 */
export function toMinor(value: DecimalLike): number {
  const s = typeof value === "string" ? value : value.toString();
  const m = /^(-?)(\d+)(?:\.(\d{1,2})\d*)?$/.exec(s.trim());
  if (!m) throw new Error(`Not a money amount: ${s}`);
  const sign = m[1] === "-" ? -1 : 1;
  const whole = Number(m[2]);
  const frac = Number((m[3] ?? "").padEnd(2, "0"));
  return sign * (whole * 100 + frac);
}

/** 123450 -> "1234.50" (what Prisma accepts for a Decimal column) */
export function fromMinor(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Parse what a person typed into a form ("1,234.5", "₹ 1234") into minor units, or null. */
export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return toMinor(cleaned);
}

export function formatMoney(minor: number, currency = "INR", locale = "en-IN"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);
}

export interface InvoiceComputation {
  grossMinor: number;
  concessionMinor: number;
  totalMinor: number;
}

/** Concessions can't push an invoice below zero. */
export function computeInvoice(lineAmountsMinor: readonly number[], concessionAmountsMinor: readonly number[]): InvoiceComputation {
  const grossMinor = lineAmountsMinor.reduce((a, b) => a + b, 0);
  const requested = concessionAmountsMinor.reduce((a, b) => a + b, 0);
  const concessionMinor = Math.min(requested, grossMinor);
  return { grossMinor, concessionMinor, totalMinor: grossMinor - concessionMinor };
}

/**
 * The stored status is PENDING/PARTIAL/PAID/CANCELLED; OVERDUE is derived
 * at read time from the due date so it flips on its own at midnight rather
 * than needing a job. `paidMinor` is successful payments net of processed
 * refunds.
 */
export function deriveStatus(args: { totalMinor: number; paidMinor: number; dueDate: Date; today: Date; cancelled: boolean }): InvoiceStatus {
  if (args.cancelled) return "CANCELLED";
  if (args.paidMinor >= args.totalMinor && args.totalMinor > 0) return "PAID";
  if (args.totalMinor === 0) return "PAID";
  const overdue = args.dueDate.getTime() < startOfDay(args.today).getTime();
  if (args.paidMinor > 0) return overdue ? "OVERDUE" : "PARTIAL";
  return overdue ? "OVERDUE" : "PENDING";
}

/** What to persist (never OVERDUE — that's derived). */
export function persistedStatus(args: { totalMinor: number; paidMinor: number; cancelled: boolean }): InvoiceStatus {
  if (args.cancelled) return "CANCELLED";
  if (args.paidMinor >= args.totalMinor) return "PAID";
  return args.paidMinor > 0 ? "PARTIAL" : "PENDING";
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function formatDocumentNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(5, "0")}`;
}

/**
 * Double-entry postings (blueprint section 8 "Accounting: accounts,
 * journal_entries, journal_lines"). A fee payment debits the asset account
 * the money arrived in and credits fee income; a refund is the exact
 * reverse. Account codes are the seeded chart's — see ledger.service.ts.
 */
export const ACCOUNT_CODES = {
  CASH: "1000",
  BANK: "1010",
  FEE_INCOME: "4000",
} as const;

export function paymentPosting(method: PaymentMethod): { debit: string; credit: string } {
  return { debit: method === "CASH" ? ACCOUNT_CODES.CASH : ACCOUNT_CODES.BANK, credit: ACCOUNT_CODES.FEE_INCOME };
}

export function refundPosting(method: PaymentMethod): { debit: string; credit: string } {
  const p = paymentPosting(method);
  return { debit: p.credit, credit: p.debit };
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  CHEQUE: "Cheque",
  BANK_TRANSFER: "Bank transfer",
  ONLINE: "Online",
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  PENDING: "Pending",
  PARTIAL: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
};
