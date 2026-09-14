import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { formatMoney, fromMinor, toMinor } from "@/modules/finance/money";
import { cancelInvoice, raiseChargeInvoice } from "@/modules/finance/invoices.service";
import {
  daysInMonth,
  FEE_HEAD_NAMES,
  isValidBillingMonth,
  monthBounds,
  monthLabel,
  prorate,
  SOURCE_KEYS,
  stayDaysInMonth,
  type BillingMonth,
} from "@/modules/finance/ops-charges";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * Library fines, hostel fees and transport fees onto family invoices.
 *
 * Operations records what happened — a book came back late, a child slept in
 * the hostel, a child rode the bus. Finance decides what it costs and bills
 * it. Rates are data the school sets; nothing is charged at a rate this
 * system invented, and a fine is never billed without a person choosing to.
 */

export interface BillingScope {
  organizationId: string;
  branchId: string;
}

const minorOrNull = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : toMinor(d));

/** The branch's library fine rate and cap. Both null means the school doesn't fine. */
export async function libraryFinePolicy(branchId: string): Promise<{ perDayMinor: number | null; capMinor: number | null }> {
  const p = await db.branchBillingPolicy.findUnique({ where: { branchId } });
  return { perDayMinor: minorOrNull(p?.libraryFinePerDay), capMinor: minorOrNull(p?.libraryFineCap) };
}

export async function getOpsBillingOverview(scope: BillingScope) {
  const [policy, blocks, routes, pendingFines] = await Promise.all([
    libraryFinePolicy(scope.branchId),
    db.hostelBlock.findMany({
      where: { branchId: scope.branchId, deletedAt: null },
      include: { rooms: { include: { _count: { select: { allocations: { where: { allocatedTo: null } } } } } } },
      orderBy: { name: "asc" },
    }),
    db.route.findMany({ where: { branchId: scope.branchId, deletedAt: null }, include: { _count: { select: { studentTransports: true } } }, orderBy: { name: "asc" } }),
    db.libraryIssue.findMany({
      where: { fineStatus: "PENDING", libraryItem: { branchId: scope.branchId } },
      include: { libraryItem: { select: { title: true } }, student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } } },
      orderBy: { returnedAt: "desc" },
      take: 100,
    }),
  ]);
  return {
    policy,
    blocks: blocks.map((b) => ({ id: b.id, name: b.name, monthlyFeeMinor: minorOrNull(b.monthlyFee), residents: b.rooms.reduce((s, r) => s + r._count.allocations, 0) })),
    routes: routes.map((r) => ({ id: r.id, name: r.name, monthlyFeeMinor: minorOrNull(r.monthlyFee), riders: r._count.studentTransports })),
    pendingFines: pendingFines.map((f) => ({
      id: f.id,
      title: f.libraryItem.title,
      student: f.student,
      dueAt: f.dueAt,
      returnedAt: f.returnedAt,
      fineMinor: minorOrNull(f.fineAmount) ?? 0,
    })),
  };
}

export async function setLibraryFinePolicy(input: { perDayMinor: number | null; capMinor: number | null }, scope: BillingScope, actor: Actor) {
  if (input.capMinor !== null && input.perDayMinor === null) throw new SisError("Set a daily rate before a cap — a cap on no fine means nothing");
  if (input.capMinor !== null && input.perDayMinor !== null && input.capMinor < input.perDayMinor) throw new SisError("The cap can't be less than one day's fine");
  const before = await libraryFinePolicy(scope.branchId);
  await db.branchBillingPolicy.upsert({
    where: { branchId: scope.branchId },
    create: { branchId: scope.branchId, libraryFinePerDay: input.perDayMinor === null ? null : fromMinor(input.perDayMinor), libraryFineCap: input.capMinor === null ? null : fromMinor(input.capMinor), updatedByUserId: actor.userId },
    update: { libraryFinePerDay: input.perDayMinor === null ? null : fromMinor(input.perDayMinor), libraryFineCap: input.capMinor === null ? null : fromMinor(input.capMinor), updatedByUserId: actor.userId },
  });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "billing_policy.library_fine_set",
    resourceType: "branch",
    resourceId: scope.branchId,
    before,
    after: input,
  });
}

export async function setMonthlyFee(kind: "hostel" | "transport", id: string, monthlyMinor: number | null, scope: BillingScope, actor: Actor) {
  if (monthlyMinor !== null && monthlyMinor <= 0) throw new SisError("A monthly fee must be more than zero — clear it to stop billing");
  const amount = monthlyMinor === null ? null : fromMinor(monthlyMinor);
  let name: string;
  if (kind === "hostel") {
    const block = await db.hostelBlock.findFirst({ where: { id, branchId: scope.branchId, deletedAt: null } });
    if (!block) throw new SisError("Hostel block not found");
    await db.hostelBlock.update({ where: { id }, data: { monthlyFee: amount } });
    name = block.name;
  } else {
    const route = await db.route.findFirst({ where: { id, branchId: scope.branchId, deletedAt: null } });
    if (!route) throw new SisError("Route not found");
    await db.route.update({ where: { id }, data: { monthlyFee: amount } });
    name = route.name;
  }
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: `billing_policy.${kind}_fee_set`,
    resourceType: kind === "hostel" ? "hostel_block" : "route",
    resourceId: id,
    after: { name, monthly: amount },
  });
}

async function pendingFine(issueId: string, scope: BillingScope) {
  const issue = await db.libraryIssue.findFirst({
    where: { id: issueId, libraryItem: { branchId: scope.branchId } },
    include: { libraryItem: { select: { title: true } }, student: { select: { id: true, firstName: true, lastName: true } } },
  });
  if (!issue || issue.fineStatus === null) throw new SisError("That fine can't be found");
  if (issue.fineStatus !== "PENDING") throw new SisError(`That fine has already been ${issue.fineStatus.toLowerCase()}`);
  return issue;
}

/**
 * Put a fine on the family's invoice.
 *
 * The invoice is raised first (idempotent on the fine's key), THEN the fine
 * is claimed with a conditional update from PENDING. If someone waived it in
 * between, the claim finds nothing and the invoice just raised is cancelled
 * again — so a fine is never both waived and billed, and never billed twice.
 */
export async function chargeLibraryFine(issueId: string, dueDateISO: string, scope: BillingScope, actor: Actor) {
  const issue = await pendingFine(issueId, scope);
  if (!issue.student) throw new SisError("Only a student's fine can go on a family invoice — waive a staff member's instead");
  const amountMinor = minorOrNull(issue.fineAmount) ?? 0;
  const daysLate = issue.returnedAt ? Math.max(0, Math.round((Date.UTC(issue.returnedAt.getUTCFullYear(), issue.returnedAt.getUTCMonth(), issue.returnedAt.getUTCDate()) - issue.dueAt.getTime()) / 86_400_000)) : 0;

  const { invoice, created } = await raiseChargeInvoice(
    {
      studentId: issue.student.id,
      sourceKey: SOURCE_KEYS.libraryFine(issue.id),
      dueDateISO,
      lines: [{ feeHeadName: FEE_HEAD_NAMES.libraryFine, amountMinor, description: `${issue.libraryItem.title} — returned ${daysLate} day${daysLate === 1 ? "" : "s"} late` }],
    },
    actor,
  );

  const claimed = await db.libraryIssue.updateMany({
    where: { id: issue.id, fineStatus: "PENDING" },
    data: { fineStatus: "CHARGED", fineInvoiceId: invoice.id, fineDecidedByUserId: actor.userId },
  });
  if (claimed.count === 0) {
    if (created) await cancelInvoice(invoice.id, "Fine was settled by someone else at the same moment", actor);
    throw new SisError("Someone else settled this fine just now — nothing was charged");
  }

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "library_fine.charged",
    resourceType: "student",
    resourceId: issue.student.id,
    after: { issueId, title: issue.libraryItem.title, amount: fromMinor(amountMinor), invoiceNumber: invoice.invoiceNumber },
  });
  return { invoiceNumber: invoice.invoiceNumber, invoiceId: invoice.id, amountMinor };
}

export async function waiveLibraryFine(issueId: string, reason: string, scope: BillingScope, actor: Actor) {
  const note = reason.trim();
  if (note.length < 3) throw new SisError("Say why the fine is being waived");
  const issue = await pendingFine(issueId, scope);
  const waived = await db.libraryIssue.updateMany({
    where: { id: issue.id, fineStatus: "PENDING" },
    data: { fineStatus: "WAIVED", fineDecidedByUserId: actor.userId, fineNote: note.slice(0, 300) },
  });
  if (waived.count === 0) throw new SisError("Someone else settled this fine just now");
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "library_fine.waived",
    resourceType: issue.student ? "student" : "library_item",
    resourceId: issue.student?.id ?? issue.libraryItemId,
    after: { issueId, title: issue.libraryItem.title, amount: issue.fineAmount?.toString() ?? null, reason: note },
  });
}

export interface BillingRunSummary {
  month: string;
  hostelInvoices: number;
  transportInvoices: number;
  alreadyBilled: number;
  failed: number;
  firstFailure: string | null;
  totalMinor: number;
}

/**
 * Bill a month of hostel and transport, for the whole branch.
 *
 * Safe to run again — later in the month, after new allocations, or by
 * mistake: every charge has its own key (a hostel stay per month, a student's
 * bus per month), so it bills only what hasn't been billed yet.
 *
 * Hostel is prorated by nights in the month (a stay has dates). Transport is
 * a full month for every student allocated to a priced route when the run
 * happens: an allocation records the route, not when it began, so there is
 * nothing honest to prorate by.
 */
export async function runMonthlyOpsBilling(input: BillingMonth & { dueDateISO: string }, scope: BillingScope, actor: Actor): Promise<BillingRunSummary> {
  if (!isValidBillingMonth(input)) throw new SisError("Pick a valid month");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDateISO)) throw new SisError("Pick a due date");

  const month: BillingMonth = { year: input.year, month: input.month };
  const { start, end } = monthBounds(month);
  const dim = daysInMonth(month);
  const label = monthLabel(month);

  const [stays, riders] = await Promise.all([
    db.hostelAllocation.findMany({
      where: {
        allocatedFrom: { lte: end },
        OR: [{ allocatedTo: null }, { allocatedTo: { gte: start } }],
        hostelRoom: { hostelBlock: { branchId: scope.branchId, deletedAt: null, monthlyFee: { not: null } } },
        student: { organizationId: scope.organizationId, deletedAt: null },
      },
      include: { hostelRoom: { include: { hostelBlock: true } } },
    }),
    db.studentTransport.findMany({
      where: { route: { branchId: scope.branchId, deletedAt: null, monthlyFee: { not: null } }, student: { organizationId: scope.organizationId, deletedAt: null, status: "ENROLLED" } },
      include: { route: true, stop: true },
    }),
  ]);

  const summary: BillingRunSummary = { month: label, hostelInvoices: 0, transportInvoices: 0, alreadyBilled: 0, failed: 0, firstFailure: null, totalMinor: 0 };
  const record = async (kind: "hostel" | "transport", fn: () => Promise<{ created: boolean; amountMinor: number }>) => {
    try {
      const r = await fn();
      if (!r.created) summary.alreadyBilled++;
      else {
        if (kind === "hostel") summary.hostelInvoices++;
        else summary.transportInvoices++;
        summary.totalMinor += r.amountMinor;
      }
    } catch (e) {
      summary.failed++;
      summary.firstFailure ??= e instanceof Error ? e.message : "Unknown error";
    }
  };

  for (const stay of stays) {
    const days = stayDaysInMonth({ from: stay.allocatedFrom, to: stay.allocatedTo }, month);
    const amountMinor = prorate(minorOrNull(stay.hostelRoom.hostelBlock.monthlyFee) ?? 0, days, dim);
    if (amountMinor <= 0) continue;
    await record("hostel", async () => {
      const { created } = await raiseChargeInvoice(
        {
          studentId: stay.studentId,
          sourceKey: SOURCE_KEYS.hostel(stay.id, month),
          dueDateISO: input.dueDateISO,
          lines: [
            {
              feeHeadName: FEE_HEAD_NAMES.hostel,
              amountMinor,
              description: `${stay.hostelRoom.hostelBlock.name} room ${stay.hostelRoom.roomNumber}, ${label} — ${days >= dim ? "full month" : `${days} of ${dim} days`}`,
            },
          ],
        },
        actor,
      );
      return { created, amountMinor };
    });
  }

  for (const rider of riders) {
    const amountMinor = minorOrNull(rider.route.monthlyFee) ?? 0;
    if (amountMinor <= 0) continue;
    await record("transport", async () => {
      const { created } = await raiseChargeInvoice(
        {
          studentId: rider.studentId,
          sourceKey: SOURCE_KEYS.transport(rider.studentId, month),
          dueDateISO: input.dueDateISO,
          lines: [{ feeHeadName: FEE_HEAD_NAMES.transport, amountMinor, description: `${rider.route.name} (stop: ${rider.stop.name}), ${label}` }],
        },
        actor,
      );
      return { created, amountMinor };
    });
  }

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "ops_billing.run",
    resourceType: "branch",
    resourceId: scope.branchId,
    after: { ...summary, total: formatMoney(summary.totalMinor) },
  });
  return summary;
}
