import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { emit } from "@/modules/automation/emit";
import type { PaymentMethod } from "@/generated/prisma/enums";
import { formatDocumentNumber, formatMoney, fromMinor, paymentPosting, persistedStatus, refundPosting, toMinor } from "@/modules/finance/money";
import { paidMinorOf } from "@/modules/finance/invoices.service";
import { ensureChartOfAccounts, postJournalEntry } from "@/modules/finance/ledger.service";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * Recording a payment (blueprint 10.6: "cashier records offline payment ->
 * receipt issued automatically"). One transaction:
 *   1. optimistic lock on the invoice (version) — a gateway webhook and a
 *      cashier can both settle the same invoice at once (section 9);
 *   2. Payment SUCCESS + Receipt with a per-org number;
 *   3. invoice status recomputed from all successful payments net of refunds;
 *   4. a balanced journal entry (Dr Cash/Bank, Cr Fee income).
 * Online gateway payments arrive through the same function later with
 * method ONLINE and a gatewayReference — the adapter is Phase 4's follow-up.
 */
export async function recordPayment(
  invoiceId: string,
  input: { amountMinor: number; method: PaymentMethod; paidAtISO: string; reference?: string },
  actor: Actor,
) {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, organizationId: actor.organizationId },
    include: { payments: { include: { refunds: true } }, student: { select: { admissionNumber: true, firstName: true, lastName: true } }, organization: { select: { slug: true } } },
  });
  if (!invoice) throw new SisError("Invoice not found");
  if (invoice.status === "CANCELLED") throw new SisError("This invoice is cancelled");

  const totalMinor = toMinor(invoice.totalAmount);
  const alreadyPaid = paidMinorOf(invoice);
  const outstanding = totalMinor - alreadyPaid;
  if (outstanding <= 0) throw new SisError("This invoice is already fully paid");
  if (input.amountMinor > outstanding) throw new SisError(`Amount exceeds the outstanding ${formatMoney(outstanding)}`);

  const paidAt = new Date(`${input.paidAtISO}T00:00:00.000Z`);
  const year = paidAt.getUTCFullYear();
  const orgTag = invoice.organization.slug.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase();

  const result = await db.$transaction(async (tx) => {
    const lock = await tx.invoice.updateMany({ where: { id: invoiceId, version: invoice.version }, data: { version: { increment: 1 } } });
    if (lock.count === 0) throw new SisError("Someone else updated this invoice — reload and try again");

    const payment = await tx.payment.create({
      data: { invoiceId, amount: fromMinor(input.amountMinor), method: input.method, status: "SUCCESS", gatewayReference: input.reference ?? null, paidAt },
    });

    const receiptCount = await tx.receipt.count({ where: { receiptNumber: { startsWith: `RCT-${orgTag}-${year}-` } } });
    const receipt = await tx.receipt.create({ data: { paymentId: payment.id, receiptNumber: formatDocumentNumber(`RCT-${orgTag}`, year, receiptCount + 1) } });

    const newPaid = alreadyPaid + input.amountMinor;
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: persistedStatus({ totalMinor, paidMinor: newPaid, cancelled: false }) } });

    await ensureChartOfAccounts(actor.organizationId, tx);
    const posting = paymentPosting(input.method);
    await postJournalEntry(tx, {
      organizationId: actor.organizationId,
      entryDate: paidAt,
      description: `Fee payment ${receipt.receiptNumber} for ${invoice.invoiceNumber} (${invoice.student.admissionNumber})`,
      createdByUserId: actor.userId,
      lines: [
        { accountCode: posting.debit, debitMinor: input.amountMinor },
        { accountCode: posting.credit, creditMinor: input.amountMinor },
      ],
    });

    return { payment, receipt, newPaid };
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "payment.recorded",
    resourceType: "invoice",
    resourceId: invoiceId,
    after: {
      receipt: result.receipt.receiptNumber,
      amount: fromMinor(input.amountMinor),
      method: input.method,
      paidAt: input.paidAtISO,
      reference: input.reference ?? null,
      invoiceStatus: persistedStatus({ totalMinor, paidMinor: result.newPaid, cancelled: false }),
    },
  });

  // AFTER the transaction has committed and the audit is written: an
  // automation must never be able to roll back a payment.
  await emit(
    "payment.received",
    {
      "payment.amount": input.amountMinor / 100,
      "payment.method": input.method,
      "invoice.number": invoice.invoiceNumber,
      "student.name": `${invoice.student.firstName} ${invoice.student.lastName}`,
    },
    { organizationId: actor.organizationId, studentId: invoice.studentId },
  );

  return result;
}

async function requirePayment(paymentId: string, organizationId: string) {
  const payment = await db.payment.findFirst({
    where: { id: paymentId, invoice: { organizationId } },
    include: { refunds: true, invoice: { include: { payments: { include: { refunds: true } } } } },
  });
  if (!payment) throw new SisError("Payment not found");
  if (payment.status !== "SUCCESS") throw new SisError("Only a successful payment can be refunded");
  return payment;
}

export async function requestRefund(paymentId: string, input: { amountMinor: number; reason: string }, actor: Actor) {
  const payment = await requirePayment(paymentId, actor.organizationId);
  const alreadyRefunded = payment.refunds.filter((r) => r.status !== "REJECTED").reduce((s, r) => s + toMinor(r.amount), 0);
  const refundable = toMinor(payment.amount) - alreadyRefunded;
  if (input.amountMinor > refundable) throw new SisError(`At most ${formatMoney(refundable)} can still be refunded from this payment`);

  const refund = await db.refund.create({ data: { paymentId, amount: fromMinor(input.amountMinor), reason: input.reason } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "refund.requested",
    resourceType: "invoice",
    resourceId: payment.invoiceId,
    after: { refundId: refund.id, paymentId, amount: fromMinor(input.amountMinor), reason: input.reason },
  });
  return refund;
}

/** REQUESTED -> APPROVED | REJECTED; APPROVED -> PROCESSED (money moves, ledger reverses, invoice status recomputed). */
export async function decideRefund(refundId: string, decision: "APPROVED" | "REJECTED" | "PROCESSED", actor: Actor) {
  const refund = await db.refund.findFirst({
    where: { id: refundId, payment: { invoice: { organizationId: actor.organizationId } } },
    include: { payment: { include: { invoice: { include: { payments: { include: { refunds: true } } } } } } },
  });
  if (!refund) throw new SisError("Refund not found");
  const allowed: Record<string, string[]> = { REQUESTED: ["APPROVED", "REJECTED"], APPROVED: ["PROCESSED", "REJECTED"], PROCESSED: [], REJECTED: [] };
  if (!allowed[refund.status].includes(decision)) throw new SisError(`A ${refund.status.toLowerCase()} refund can't become ${decision.toLowerCase()}`);

  const invoice = refund.payment.invoice;
  const amountMinor = toMinor(refund.amount);

  await db.$transaction(async (tx) => {
    await tx.refund.update({ where: { id: refundId }, data: { status: decision, ...(decision === "PROCESSED" ? { processedAt: new Date() } : {}) } });
    if (decision === "PROCESSED") {
      const lock = await tx.invoice.updateMany({ where: { id: invoice.id, version: invoice.version }, data: { version: { increment: 1 } } });
      if (lock.count === 0) throw new SisError("The invoice changed while processing — reload and try again");
      const totalMinor = toMinor(invoice.totalAmount);
      const newPaid = paidMinorOf(invoice) - amountMinor;
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: persistedStatus({ totalMinor, paidMinor: newPaid, cancelled: false }) } });
      await ensureChartOfAccounts(actor.organizationId, tx);
      const posting = refundPosting(refund.payment.method);
      await postJournalEntry(tx, {
        organizationId: actor.organizationId,
        entryDate: new Date(),
        description: `Refund on ${invoice.invoiceNumber}: ${refund.reason}`,
        createdByUserId: actor.userId,
        lines: [
          { accountCode: posting.debit, debitMinor: amountMinor },
          { accountCode: posting.credit, creditMinor: amountMinor },
        ],
      });
    }
  });

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: `refund.${decision.toLowerCase()}`,
    resourceType: "invoice",
    resourceId: invoice.id,
    before: { status: refund.status },
    after: { refundId, status: decision, amount: fromMinor(amountMinor) },
  });
}
