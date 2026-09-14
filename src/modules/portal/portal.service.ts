import "server-only";
import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { ACADEMICS_FLAG, FINANCE_FLAG, LMS_FLAG, OPERATIONS_FLAG } from "@/modules/sis/access";
import { summarize } from "@/modules/academics/attendance-summary";
import { deriveStatus, toMinor } from "@/modules/finance/money";
import { paidMinorOf } from "@/modules/finance/invoices.service";
import { deriveSubmissionStatus } from "@/modules/lms/grading";
import type { PortalScope } from "@/modules/portal/scope";

/**
 * Every read the portal makes. All of them take a studentId that has already
 * been checked against the viewer's scope (see studentInScope), and all of
 * them re-assert the organization, so a scope bug alone is not enough to
 * cross a tenant boundary.
 *
 * Each section is also gated on the module's own feature flag: a school that
 * has Finance switched off should not show parents a fees tab that is empty
 * for the wrong reason.
 */

export async function getPortalChild(studentId: string, organizationId: string) {
  return db.student.findFirst({
    where: { id: studentId, organizationId, deletedAt: null },
    include: {
      currentSection: { include: { grade: true } },
      branch: true,
      transportLink: { include: { route: { include: { vehicle: true } }, stop: true } },
      hostelAllocations: { where: { allocatedTo: null }, include: { hostelRoom: { include: { hostelBlock: true } } } },
    },
  });
}

const DAYS_BACK = 30;

export async function getAttendanceSummary(studentId: string, organizationId: string) {
  if (!(await isFeatureEnabled(ACADEMICS_FLAG, organizationId))) return null;
  const since = new Date(Date.now() - DAYS_BACK * 86_400_000);
  const records = await db.attendanceRecord.findMany({
    where: { studentId, session: { date: { gte: since } }, student: { organizationId } },
    include: { session: { select: { date: true } } },
    orderBy: { session: { date: "desc" } },
  });
  return {
    summary: summarize(records.map((r) => r.status)),
    recent: records.slice(0, 10).map((r) => ({ date: r.session.date, status: r.status })),
  };
}

export async function getTimetable(studentId: string, organizationId: string) {
  if (!(await isFeatureEnabled(ACADEMICS_FLAG, organizationId))) return null;
  const student = await db.student.findFirst({ where: { id: studentId, organizationId }, select: { currentSectionId: true } });
  if (!student?.currentSectionId) return [];
  return db.timetableSlot.findMany({
    where: { sectionId: student.currentSectionId },
    include: { subject: true, staff: { include: { user: true } } },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });
}

/** Dues only — a parent needs the balance, not the whole ledger. */
export async function getFees(studentId: string, organizationId: string) {
  if (!(await isFeatureEnabled(FINANCE_FLAG, organizationId))) return null;
  const invoices = await db.invoice.findMany({
    where: { studentId, student: { organizationId } },
    // Refunds hang off Payment, not Invoice. paidMinorOf is Finance's single
    // definition of "how much has actually been paid" — reused rather than
    // reimplemented, so the portal can never disagree with the fee desk.
    include: { payments: { include: { refunds: true } } },
    orderBy: { dueDate: "desc" },
    take: 20,
  });
  const today = new Date();
  const rows = invoices.map((inv) => {
    const paidMinor = paidMinorOf(inv);
    const totalMinor = toMinor(inv.totalAmount);
    return {
      id: inv.id,
      number: inv.invoiceNumber,
      dueDate: inv.dueDate,
      totalMinor,
      paidMinor,
      outstandingMinor: Math.max(0, totalMinor - paidMinor),
      status: deriveStatus({ totalMinor, paidMinor, dueDate: inv.dueDate, today, cancelled: inv.status === "CANCELLED" }),
    };
  });
  return { rows, outstandingMinor: rows.reduce((s, r) => s + (r.status === "CANCELLED" ? 0 : r.outstandingMinor), 0) };
}

export async function getAssignments(studentId: string, organizationId: string) {
  if (!(await isFeatureEnabled(LMS_FLAG, organizationId))) return null;
  const student = await db.student.findFirst({ where: { id: studentId, organizationId }, select: { currentSectionId: true } });
  if (!student?.currentSectionId) return [];

  const assignments = await db.assignment.findMany({
    where: { sectionId: student.currentSectionId, publishedAt: { not: null } },
    include: { course: { include: { subject: true } }, submissions: { where: { studentId } } },
    orderBy: { dueAt: "desc" },
    take: 25,
  });

  return assignments.map((a) => {
    const submission = a.submissions[0] ?? null;
    return {
      id: a.id,
      title: a.title,
      subject: a.course?.subject?.name ?? null,
      dueAt: a.dueAt,
      maxMarks: a.maxMarks,
      marksAwarded: submission?.marksAwarded ?? null,
      feedback: submission?.feedback ?? null,
      status: deriveSubmissionStatus({
        submittedAt: submission?.submittedAt ?? null,
        dueAt: a.dueAt,
        marksAwarded: submission?.marksAwarded ?? null,
      }),
    };
  });
}

/** Infirmary visits for one's own child — the guardian was told anyway. */
export async function getClinicVisits(studentId: string, organizationId: string) {
  if (!(await isFeatureEnabled(OPERATIONS_FLAG, organizationId))) return null;
  return db.clinicVisit.findMany({
    where: { studentId, student: { organizationId } },
    orderBy: { visitedAt: "desc" },
    take: 10,
  });
}

/** The driver's manifest: name, section and stop. Nothing else. */
export async function getDriverManifest(scope: PortalScope) {
  return db.studentTransport.findMany({
    where: { studentId: { in: scope.studentIds }, student: { organizationId: scope.organizationId, deletedAt: null } },
    select: {
      id: true,
      student: { select: { firstName: true, lastName: true, currentSection: { select: { name: true, grade: { select: { name: true } } } } } },
      route: { select: { name: true, vehicle: { select: { registrationNumber: true } } } },
      stop: { select: { name: true, sequence: true } },
    },
    orderBy: [{ route: { name: "asc" } }, { stop: { sequence: "asc" } }],
  });
}

export async function getAnnouncements(studentId: string, organizationId: string) {
  const links = await db.studentGuardian.findMany({ where: { studentId }, select: { guardian: { select: { phone: true } } } });
  const addresses = links.map((l) => l.guardian.phone).filter(Boolean);
  if (addresses.length === 0) return [];
  // What was actually sent to this family, from the delivery log — rather
  // than a separate "announcements" store that could disagree with it.
  return db.message.findMany({
    where: { organizationId, recipientAddress: { in: addresses }, status: { in: ["SENT", "DELIVERED"] } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, body: true, channel: true, createdAt: true },
  });
}
