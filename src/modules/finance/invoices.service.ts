import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { Prisma } from "@/generated/prisma/client";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import { computeInvoice, deriveStatus, formatDocumentNumber, fromMinor, toMinor } from "@/modules/finance/money";
import { SisError, type Actor } from "@/modules/sis/students.service";

export const INVOICE_PAGE_SIZE = 50;

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/** Successful payments minus processed refunds, in minor units. */
export function paidMinorOf(invoice: { payments: { status: string; amount: { toString(): string }; refunds: { status: string; amount: { toString(): string } }[] }[] }): number {
  let paid = 0;
  for (const p of invoice.payments) {
    if (p.status !== "SUCCESS") continue;
    paid += toMinor(p.amount);
    for (const r of p.refunds) if (r.status === "PROCESSED") paid -= toMinor(r.amount);
  }
  return paid;
}

const invoiceInclude = {
  student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true, currentSection: { include: { grade: true } } } },
  feeStructure: { select: { name: true } },
  lines: { include: { feeHead: true } },
  payments: { include: { receipt: true, refunds: true }, orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.InvoiceInclude;

export type InvoiceWithDetails = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

export function decorate(invoice: InvoiceWithDetails, today = new Date()) {
  const totalMinor = toMinor(invoice.totalAmount);
  const paidMinor = paidMinorOf(invoice);
  const displayStatus: InvoiceStatus = deriveStatus({ totalMinor, paidMinor, dueDate: invoice.dueDate, today, cancelled: invoice.status === "CANCELLED" });
  return { ...invoice, totalMinor, paidMinor, outstandingMinor: Math.max(0, totalMinor - paidMinor), displayStatus };
}

/**
 * Raises one invoice for one student from a fee structure. Lines are copied
 * (a later change to the structure must not rewrite history); concessions
 * for this student that name this structure or no structure are applied,
 * capped at the gross. Idempotent per (student, structure): a second call
 * returns the existing invoice rather than double-billing.
 */
export async function raiseInvoice(studentId: string, feeStructureId: string, dueDateISO: string, actor: Actor) {
  const [student, structure] = await Promise.all([
    db.student.findFirst({ where: { id: studentId, organizationId: actor.organizationId, deletedAt: null } }),
    db.feeStructure.findFirst({
      where: { id: feeStructureId, deletedAt: null, branch: { organizationId: actor.organizationId } },
      include: { lines: { include: { feeHead: true } }, academicYear: true },
    }),
  ]);
  if (!student) throw new SisError("Student not found");
  if (!structure) throw new SisError("Fee structure not found");
  if (structure.branchId !== student.branchId) throw new SisError("That fee structure belongs to a different branch");
  if (structure.lines.length === 0) throw new SisError("The fee structure has no lines");

  const existing = await db.invoice.findFirst({ where: { studentId, feeStructureId, status: { not: "CANCELLED" } } });
  if (existing) return { invoice: existing, created: false };

  const concessions = await db.concession.findMany({
    where: { studentId, OR: [{ feeStructureId }, { feeStructureId: null }] },
  });
  const calc = computeInvoice(
    structure.lines.map((l) => toMinor(l.amount)),
    concessions.map((c) => toMinor(c.amount)),
  );
  const year = new Date().getUTCFullYear();

  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await db.invoice.count({ where: { organizationId: actor.organizationId, invoiceNumber: { startsWith: `INV-${year}-` } } });
    const invoiceNumber = formatDocumentNumber("INV", year, count + 1 + attempt);
    try {
      const invoice = await db.invoice.create({
        data: {
          organizationId: actor.organizationId,
          studentId,
          academicYearId: structure.academicYearId,
          feeStructureId,
          invoiceNumber,
          totalAmount: fromMinor(calc.totalMinor),
          dueDate: new Date(`${dueDateISO}T00:00:00.000Z`),
          status: calc.totalMinor === 0 ? "PAID" : "PENDING",
          lines: { create: structure.lines.map((l) => ({ feeHeadId: l.feeHeadId, amount: l.amount })) },
        },
      });
      await recordAuditEvent({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: "invoice.raised",
        resourceType: "invoice",
        resourceId: invoice.id,
        after: {
          invoiceNumber,
          studentId,
          admissionNumber: student.admissionNumber,
          structure: structure.name,
          gross: fromMinor(calc.grossMinor),
          concession: fromMinor(calc.concessionMinor),
          total: fromMinor(calc.totalMinor),
          dueDate: dueDateISO,
        },
      });
      return { invoice, created: true };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // another writer took this number; try the next
    }
  }
  throw new SisError("Couldn't allocate an invoice number — please retry");
}

/** Raise the same structure for every enrolled student in a section. Skips students already invoiced for it. */
export async function raiseInvoicesForSection(sectionId: string, feeStructureId: string, dueDateISO: string, actor: Actor) {
  const students = await db.student.findMany({
    where: { currentSectionId: sectionId, status: "ENROLLED", deletedAt: null, organizationId: actor.organizationId },
    select: { id: true },
  });
  let created = 0;
  let skipped = 0;
  for (const s of students) {
    const r = await raiseInvoice(s.id, feeStructureId, dueDateISO, actor);
    if (r.created) created++;
    else skipped++;
  }
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "invoices.raised_for_section",
    resourceType: "section",
    resourceId: sectionId,
    after: { feeStructureId, dueDate: dueDateISO, created, skipped },
  });
  return { created, skipped, total: students.length };
}

export interface InvoiceListQuery {
  organizationId: string;
  branchId: string;
  q?: string;
  status?: InvoiceStatus; // display status; OVERDUE handled in code
  page?: number;
}

export async function listInvoices(query: InvoiceListQuery) {
  const page = Math.max(1, query.page ?? 1);
  const q = query.q?.trim();
  const where: Prisma.InvoiceWhereInput = {
    organizationId: query.organizationId,
    student: { branchId: query.branchId },
    ...(q
      ? {
          OR: [
            { invoiceNumber: { contains: q, mode: "insensitive" } },
            { student: { firstName: { contains: q, mode: "insensitive" } } },
            { student: { lastName: { contains: q, mode: "insensitive" } } },
            { student: { admissionNumber: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
    // OVERDUE is derived; filter the persisted equivalents and refine below.
    ...(query.status === "OVERDUE" ? { status: { in: ["PENDING", "PARTIAL"] }, dueDate: { lt: new Date() } } : query.status ? { status: query.status } : {}),
  };
  const [total, rows] = await Promise.all([
    db.invoice.count({ where }),
    db.invoice.findMany({ where, include: invoiceInclude, orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }], skip: (page - 1) * INVOICE_PAGE_SIZE, take: INVOICE_PAGE_SIZE }),
  ]);
  const today = new Date();
  return { items: rows.map((r) => decorate(r, today)), total, page, pageCount: Math.max(1, Math.ceil(total / INVOICE_PAGE_SIZE)) };
}

export async function getInvoice(invoiceId: string, organizationId: string) {
  const invoice = await db.invoice.findFirst({ where: { id: invoiceId, organizationId }, include: invoiceInclude });
  if (!invoice) return null;
  const timeline = await db.auditEvent.findMany({
    where: { organizationId, resourceType: "invoice", resourceId: invoiceId },
    include: { actorUser: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return { invoice: decorate(invoice), timeline };
}

/** Cancel is allowed only with no successful payments; uses the version column. */
export async function cancelInvoice(invoiceId: string, reason: string | undefined, actor: Actor) {
  const invoice = await db.invoice.findFirst({ where: { id: invoiceId, organizationId: actor.organizationId }, include: { payments: { where: { status: "SUCCESS" } } } });
  if (!invoice) throw new SisError("Invoice not found");
  if (invoice.status === "CANCELLED") throw new SisError("Already cancelled");
  if (invoice.payments.length > 0) throw new SisError("This invoice has payments — refund them first");

  const { count } = await db.invoice.updateMany({ where: { id: invoiceId, version: invoice.version }, data: { status: "CANCELLED", version: { increment: 1 } } });
  if (count === 0) throw new SisError("The invoice changed while you were looking at it — reload and try again");

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "invoice.cancelled",
    resourceType: "invoice",
    resourceId: invoiceId,
    before: { status: invoice.status },
    after: { status: "CANCELLED", ...(reason ? { reason } : {}) },
  });
}

/** Branch-level dues for the Finance index. */
export async function duesSummary(organizationId: string, branchId: string) {
  const invoices = await db.invoice.findMany({
    where: { organizationId, student: { branchId }, status: { in: ["PENDING", "PARTIAL"] } },
    include: { payments: { include: { refunds: true } } },
  });
  const today = new Date();
  let outstandingMinor = 0;
  let overdueCount = 0;
  let overdueMinor = 0;
  for (const inv of invoices) {
    const total = toMinor(inv.totalAmount);
    const paid = paidMinorOf(inv);
    const out = Math.max(0, total - paid);
    outstandingMinor += out;
    if (inv.dueDate.getTime() < Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) {
      overdueCount++;
      overdueMinor += out;
    }
  }
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const collected = await db.payment.aggregate({
    where: { status: "SUCCESS", paidAt: { gte: monthStart }, invoice: { organizationId, student: { branchId } } },
    _sum: { amount: true },
  });
  return { openInvoices: invoices.length, outstandingMinor, overdueCount, overdueMinor, collectedThisMonthMinor: toMinor(collected._sum.amount ?? 0) };
}

/** For the Student 360 fee card. */
export async function studentFeeSummary(studentId: string, organizationId: string) {
  const invoices = await db.invoice.findMany({ where: { studentId, organizationId }, include: invoiceInclude, orderBy: { createdAt: "desc" } });
  const today = new Date();
  const decorated = invoices.map((i) => decorate(i, today));
  const live = decorated.filter((i) => i.status !== "CANCELLED");
  return {
    invoices: decorated,
    invoicedMinor: live.reduce((s, i) => s + i.totalMinor, 0),
    paidMinor: live.reduce((s, i) => s + i.paidMinor, 0),
    outstandingMinor: live.reduce((s, i) => s + i.outstandingMinor, 0),
  };
}
