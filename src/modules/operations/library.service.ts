import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { availableFrom, checkCanBorrow, checkTotalCopiesChange, daysOverdue, DEFAULT_LOAN_DAYS, dueDateFrom } from "@/modules/operations/library";
import { fromMinor } from "@/modules/finance/money";
import { libraryFine } from "@/modules/finance/ops-charges";
import { libraryFinePolicy } from "@/modules/finance/ops-billing.service";
import { SisError, type Actor } from "@/modules/sis/students.service";

export interface OpsScope {
  organizationId: string;
  branchId: string;
}

export async function listLibraryItems(scope: OpsScope, search?: string) {
  return db.libraryItem.findMany({
    where: {
      branchId: scope.branchId,
      deletedAt: null,
      ...(search
        ? { OR: [{ title: { contains: search, mode: "insensitive" as const } }, { author: { contains: search, mode: "insensitive" as const } }, { isbn: { contains: search } }] }
        : {}),
    },
    include: { _count: { select: { issues: { where: { returnedAt: null } } } } },
    orderBy: { title: "asc" },
    take: 100,
  });
}

export async function getLibraryItem(itemId: string, scope: OpsScope) {
  return db.libraryItem.findFirst({
    where: { id: itemId, branchId: scope.branchId, deletedAt: null },
    include: {
      issues: {
        include: { student: true, staff: { include: { user: true } } },
        orderBy: [{ returnedAt: "asc" }, { issuedAt: "desc" }],
        take: 40,
      },
    },
  });
}

/** Loans still out, newest due first — the librarian's chase list. */
export async function listOpenLoans(scope: OpsScope) {
  return db.libraryIssue.findMany({
    where: { returnedAt: null, libraryItem: { branchId: scope.branchId, deletedAt: null } },
    include: { libraryItem: true, student: true, staff: { include: { user: true } } },
    orderBy: { dueAt: "asc" },
    take: 100,
  });
}

export async function createLibraryItem(input: { title: string; author?: string; isbn?: string; totalCopies: number }, scope: OpsScope, actor: Actor) {
  if (!Number.isInteger(input.totalCopies) || input.totalCopies < 1) throw new SisError("A title needs at least one copy");

  const item = await db.libraryItem.create({
    data: {
      branchId: scope.branchId,
      title: input.title,
      author: input.author ?? null,
      isbn: input.isbn ?? null,
      totalCopies: input.totalCopies,
      availableCopies: input.totalCopies,
    },
  });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "library_item.created",
    resourceType: "library_item",
    resourceId: item.id,
    after: { title: input.title, totalCopies: input.totalCopies },
  });
  return item;
}

/**
 * Changing the copy count recomputes availability from what is actually on
 * loan rather than shifting the stored number by a delta — a delta compounds
 * any drift that already exists, a recompute corrects it.
 */
export async function setTotalCopies(itemId: string, newTotal: number, scope: OpsScope, actor: Actor) {
  const item = await db.libraryItem.findFirst({ where: { id: itemId, branchId: scope.branchId, deletedAt: null } });
  if (!item) throw new SisError("Title not found");

  const onLoan = await db.libraryIssue.count({ where: { libraryItemId: itemId, returnedAt: null } });
  const check = checkTotalCopiesChange({ newTotal, onLoan });
  if (!check.ok) throw new SisError(check.message);

  await db.libraryItem.update({
    where: { id: itemId },
    data: { totalCopies: newTotal, availableCopies: availableFrom(newTotal, onLoan) },
  });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "library_item.copies_changed",
    resourceType: "library_item",
    resourceId: itemId,
    before: { totalCopies: item.totalCopies, availableCopies: item.availableCopies },
    after: { totalCopies: newTotal, availableCopies: availableFrom(newTotal, onLoan), onLoan },
  });
}

export type Borrower = { kind: "student"; id: string } | { kind: "staff"; id: string };

/**
 * Issue a copy.
 *
 * The interesting part is the write, not the checks. Two librarians can scan
 * the last copy at the same moment; a read-then-write would let both through
 * and leave availableCopies at -1. So the decrement is a CONDITIONAL update —
 * `updateMany` with `availableCopies: { gt: 0 }` in the where — and a count
 * of 0 rows means someone else took the copy between our check and our write.
 * That's Postgres enforcing the invariant, not us hoping.
 */
export async function issueLibraryItem(
  itemId: string,
  borrower: Borrower,
  opts: { loanDays?: number },
  scope: OpsScope,
  actor: Actor,
) {
  const item = await db.libraryItem.findFirst({ where: { id: itemId, branchId: scope.branchId, deletedAt: null } });
  if (!item) throw new SisError("Title not found");

  const borrowerWhere = borrower.kind === "student" ? { studentId: borrower.id } : { staffId: borrower.id };
  let borrowerName: string;
  if (borrower.kind === "student") {
    const student = await db.student.findFirst({ where: { id: borrower.id, organizationId: scope.organizationId, deletedAt: null } });
    if (!student) throw new SisError("Student not found");
    borrowerName = `${student.firstName} ${student.lastName}`;
  } else {
    const staff = await db.staff.findFirst({
      where: { id: borrower.id, organizationId: scope.organizationId, deletedAt: null },
      include: { user: true },
    });
    if (!staff) throw new SisError("Staff member not found");
    if (staff.exitDate) throw new SisError("This staff member has left the school");
    borrowerName = staff.user.name;
  }

  const [openLoansByBorrower, sameTitle] = await Promise.all([
    db.libraryIssue.count({ where: { ...borrowerWhere, returnedAt: null } }),
    db.libraryIssue.count({ where: { ...borrowerWhere, libraryItemId: itemId, returnedAt: null } }),
  ]);
  const check = checkCanBorrow({
    availableCopies: item.availableCopies,
    openLoansByBorrower,
    alreadyHasThisTitle: sameTitle > 0,
  });
  if (!check.ok) throw new SisError(check.message);

  const issuedAt = new Date();
  const dueAt = dueDateFrom(issuedAt, opts.loanDays ?? DEFAULT_LOAN_DAYS);

  const issue = await db.$transaction(async (tx) => {
    const claimed = await tx.libraryItem.updateMany({
      where: { id: itemId, availableCopies: { gt: 0 } },
      data: { availableCopies: { decrement: 1 } },
    });
    if (claimed.count === 0) throw new SisError("The last copy was just issued to someone else");

    return tx.libraryIssue.create({
      data: { libraryItemId: itemId, ...borrowerWhere, issuedAt, dueAt, issuedByUserId: actor.userId },
    });
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "library_item.issued",
    resourceType: "library_item",
    resourceId: itemId,
    after: { issueId: issue.id, borrower: borrowerName, borrowerKind: borrower.kind, dueAt: dueAt.toISOString().slice(0, 10) },
  });
  return issue;
}

/**
 * Return a copy. Guarded the same way: the update only matches a row that is
 * still un-returned, so a double-scan can't credit the copy back twice.
 */
export async function returnLibraryItem(issueId: string, scope: OpsScope, actor: Actor) {
  const issue = await db.libraryIssue.findFirst({
    where: { id: issueId, libraryItem: { branchId: scope.branchId } },
    include: { libraryItem: true },
  });
  if (!issue) throw new SisError("Loan not found");
  if (issue.returnedAt) throw new SisError("This copy was already returned");

  const returnedAt = new Date();
  // A late fine is fixed now, at the rate in force today: changing the rate
  // next month must not re-price a book that came back this month. Only a
  // STUDENT's loan is fined — a staff member's can't go on a family invoice,
  // and docking pay is not the library's call.
  const daysLate = daysOverdue({ dueAt: issue.dueAt, returnedAt }, returnedAt);
  const policy = issue.studentId && daysLate > 0 ? await libraryFinePolicy(scope.branchId) : null;
  const fineMinor = policy ? libraryFine({ daysOverdue: daysLate, perDayMinor: policy.perDayMinor, capMinor: policy.capMinor }) : 0;

  await db.$transaction(async (tx) => {
    const closed = await tx.libraryIssue.updateMany({
      where: { id: issueId, returnedAt: null },
      data: { returnedAt, returnedByUserId: actor.userId, ...(fineMinor > 0 ? { fineAmount: fromMinor(fineMinor), fineStatus: "PENDING" as const } : {}) },
    });
    if (closed.count === 0) throw new SisError("This copy was already returned");

    // Never exceed totalCopies, even if the stored counter had drifted.
    await tx.libraryItem.updateMany({
      where: { id: issue.libraryItemId, availableCopies: { lt: issue.libraryItem.totalCopies } },
      data: { availableCopies: { increment: 1 } },
    });
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "library_item.returned",
    resourceType: "library_item",
    resourceId: issue.libraryItemId,
    after: { issueId, returnedAt: returnedAt.toISOString(), dueAt: issue.dueAt.toISOString().slice(0, 10), daysLate, fine: fineMinor > 0 ? fromMinor(fineMinor) : null },
  });
  return { daysLate, fineMinor };
}
