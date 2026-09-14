import "server-only";
import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { ACADEMICS_FLAG, ADMISSIONS_FLAG, FINANCE_FLAG, OPERATIONS_FLAG } from "@/modules/sis/access";
import { summarize } from "@/modules/academics/attendance-summary";
import { paidMinorOf } from "@/modules/finance/invoices.service";
import { formatMoney, fromMinor, toMinor } from "@/modules/finance/money";
import { rate, type DateRange } from "@/modules/analytics/reports";

/**
 * Analytics reads across modules. It owns no tables of its own: every figure
 * here is computed from the module that owns it, using that module's own
 * helpers (paidMinorOf, summarize) rather than a second implementation.
 *
 * A reporting layer that recomputes "how much is paid" its own way is how a
 * dashboard ends up disagreeing with the fee desk, and the fee desk is
 * always the one that's right.
 */

export interface AnalyticsScope {
  organizationId: string;
  branchId: string;
}

export interface Kpi {
  label: string;
  value: string;
  hint?: string;
  href?: string;
}

/** The headline numbers, each gated on the flag of the module it comes from. */
export async function dashboardKpis(scope: AnalyticsScope): Promise<Kpi[]> {
  const [academicsOn, financeOn, admissionsOn, opsOn] = await Promise.all([
    isFeatureEnabled(ACADEMICS_FLAG, scope.organizationId),
    isFeatureEnabled(FINANCE_FLAG, scope.organizationId),
    isFeatureEnabled(ADMISSIONS_FLAG, scope.organizationId),
    isFeatureEnabled(OPERATIONS_FLAG, scope.organizationId),
  ]);

  const kpis: Kpi[] = [];

  const [enrolled, staff] = await Promise.all([
    db.student.count({ where: { organizationId: scope.organizationId, branchId: scope.branchId, deletedAt: null, status: "ENROLLED" } }),
    db.staff.count({ where: { organizationId: scope.organizationId, branchId: scope.branchId, deletedAt: null, exitDate: null } }),
  ]);
  kpis.push({ label: "Students on roll", value: String(enrolled), href: "/students" });
  kpis.push({
    label: "Staff",
    value: String(staff),
    hint: staff > 0 ? `${(enrolled / staff).toFixed(1)} students per staff member` : undefined,
    href: "/staff",
  });

  if (academicsOn) {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const records = await db.attendanceRecord.findMany({
      where: { student: { organizationId: scope.organizationId, branchId: scope.branchId }, session: { date: { gte: since } } },
      select: { status: true },
    });
    const counts = summarize(records.map((r) => r.status));
    kpis.push({
      label: "Attendance (30 days)",
      value: counts.attendedRate === null ? "—" : `${Math.round(counts.attendedRate * 100)}%`,
      hint: `${counts.total} record${counts.total === 1 ? "" : "s"}`,
      href: "/academics",
    });
  }

  if (financeOn) {
    const invoices = await db.invoice.findMany({
      where: { student: { organizationId: scope.organizationId, branchId: scope.branchId } },
      include: { payments: { include: { refunds: true } } },
    });
    let invoiced = 0;
    let collected = 0;
    for (const inv of invoices) {
      if (inv.status === "CANCELLED") continue;
      invoiced += toMinor(inv.totalAmount);
      collected += paidMinorOf(inv);
    }
    kpis.push({
      label: "Fees outstanding",
      value: formatMoney(Math.max(0, invoiced - collected)),
      hint: `${rate(collected, invoiced)} of ${formatMoney(invoiced)} collected`,
      href: "/finance",
    });
  }

  if (admissionsOn) {
    const [open, admitted] = await Promise.all([
      db.lead.count({ where: { branchId: scope.branchId, stage: { in: ["NEW", "CONTACTED", "QUALIFIED", "APPLIED"] }, deletedAt: null } }),
      db.lead.count({ where: { branchId: scope.branchId, stage: "ADMITTED", deletedAt: null } }),
    ]);
    kpis.push({ label: "Open leads", value: String(open), hint: `${admitted} admitted`, href: "/admissions" });
  }

  if (opsOn) {
    const [overdue, onSite] = await Promise.all([
      db.libraryIssue.count({ where: { returnedAt: null, dueAt: { lt: new Date() }, libraryItem: { branchId: scope.branchId } } }),
      db.visitorLog.count({ where: { branchId: scope.branchId, checkOutAt: null } }),
    ]);
    kpis.push({ label: "Books overdue", value: String(overdue), href: "/operations/library" });
    kpis.push({ label: "Visitors on site", value: String(onSite), href: "/operations/visitors" });
  }

  return kpis;
}

export type ReportRows = { header: string[]; rows: string[][] };

/**
 * Runs one report by key. The key has already been resolved to a definition
 * and its permission checked by the caller — this function only knows how to
 * fetch. Each branch is a hand-written query, deliberately: there is no
 * generic query builder here for anything a user supplies to steer.
 */
export async function runReport(key: string, scope: AnalyticsScope, range: DateRange): Promise<ReportRows> {
  switch (key) {
    case "students_by_section":
      return studentsBySection(scope);
    case "attendance_by_section":
      return attendanceBySection(scope, range);
    case "fee_collection":
      return feeCollection(scope);
    case "defaulters":
      return defaulters(scope);
    case "staff_directory":
      return staffDirectory(scope);
    case "admissions_funnel":
      return admissionsFunnel(scope);
    default:
      throw new Error(`Unknown report: ${key}`);
  }
}

async function studentsBySection(scope: AnalyticsScope): Promise<ReportRows> {
  const students = await db.student.findMany({
    where: { organizationId: scope.organizationId, branchId: scope.branchId, deletedAt: null },
    include: { currentSection: { include: { grade: true } } },
    orderBy: [{ currentSection: { grade: { sequence: "asc" } } }, { firstName: "asc" }],
  });
  return {
    header: ["admission_number", "name", "grade", "section", "status", "admitted"],
    rows: students.map((s) => [
      s.admissionNumber,
      `${s.firstName} ${s.lastName}`,
      s.currentSection?.grade.name ?? "",
      s.currentSection?.name ?? "",
      s.status,
      s.admissionDate?.toISOString().slice(0, 10) ?? "",
    ]),
  };
}

async function attendanceBySection(scope: AnalyticsScope, range: DateRange): Promise<ReportRows> {
  const sections = await db.section.findMany({
    where: { grade: { branchId: scope.branchId } },
    include: { grade: true },
    orderBy: [{ grade: { sequence: "asc" } }, { name: "asc" }],
  });
  const records = await db.attendanceRecord.findMany({
    where: {
      session: { date: { gte: new Date(`${range.from}T00:00:00Z`), lte: new Date(`${range.to}T23:59:59Z`) } },
      student: { organizationId: scope.organizationId },
    },
    select: { status: true, session: { select: { sectionId: true, id: true } } },
  });

  const bySection = new Map<string, { statuses: typeof records[number]["status"][]; sessions: Set<string> }>();
  for (const r of records) {
    const entry = bySection.get(r.session.sectionId) ?? { statuses: [], sessions: new Set<string>() };
    entry.statuses.push(r.status);
    entry.sessions.add(r.session.id);
    bySection.set(r.session.sectionId, entry);
  }

  return {
    header: ["grade", "section", "sessions", "present", "absent", "late", "excused", "rate"],
    rows: sections.map((s) => {
      const entry = bySection.get(s.id);
      const counts = summarize(entry?.statuses ?? []);
      return [
        s.grade.name,
        s.name,
        String(entry?.sessions.size ?? 0),
        String(counts.present),
        String(counts.absent),
        String(counts.late),
        String(counts.excused),
        counts.attendedRate === null ? "—" : `${Math.round(counts.attendedRate * 100)}%`,
      ];
    }),
  };
}

async function feeCollection(scope: AnalyticsScope): Promise<ReportRows> {
  const invoices = await db.invoice.findMany({
    where: { student: { organizationId: scope.organizationId, branchId: scope.branchId } },
    include: { payments: { include: { refunds: true } }, student: { include: { currentSection: { include: { grade: true } } } } },
  });
  const today = new Date();
  const byGrade = new Map<string, { invoices: number; invoiced: number; collected: number; overdue: number }>();
  for (const inv of invoices) {
    if (inv.status === "CANCELLED") continue;
    const grade = inv.student.currentSection?.grade.name ?? "Unassigned";
    const row = byGrade.get(grade) ?? { invoices: 0, invoiced: 0, collected: 0, overdue: 0 };
    const total = toMinor(inv.totalAmount);
    const paid = paidMinorOf(inv);
    row.invoices += 1;
    row.invoiced += total;
    row.collected += paid;
    if (paid < total && inv.dueDate < today) row.overdue += 1;
    byGrade.set(grade, row);
  }
  return {
    header: ["grade", "invoices", "invoiced", "collected", "outstanding", "overdue_invoices"],
    rows: [...byGrade.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([grade, r]) => [
        grade,
        String(r.invoices),
        fromMinor(r.invoiced),
        fromMinor(r.collected),
        fromMinor(Math.max(0, r.invoiced - r.collected)),
        String(r.overdue),
      ]),
  };
}

async function defaulters(scope: AnalyticsScope): Promise<ReportRows> {
  const invoices = await db.invoice.findMany({
    where: { student: { organizationId: scope.organizationId, branchId: scope.branchId }, status: { in: ["PENDING", "PARTIAL"] } },
    include: { payments: { include: { refunds: true } }, student: { include: { currentSection: { include: { grade: true } } } } },
  });
  const today = new Date();
  const byStudent = new Map<string, { name: string; admission: string; grade: string; section: string; overdue: number; outstanding: number }>();
  for (const inv of invoices) {
    const outstanding = toMinor(inv.totalAmount) - paidMinorOf(inv);
    if (outstanding <= 0 || inv.dueDate >= today) continue;
    const s = inv.student;
    const row = byStudent.get(s.id) ?? {
      name: `${s.firstName} ${s.lastName}`,
      admission: s.admissionNumber,
      grade: s.currentSection?.grade.name ?? "",
      section: s.currentSection?.name ?? "",
      overdue: 0,
      outstanding: 0,
    };
    row.overdue += 1;
    row.outstanding += outstanding;
    byStudent.set(s.id, row);
  }
  return {
    header: ["admission_number", "name", "grade", "section", "overdue_invoices", "outstanding"],
    rows: [...byStudent.values()]
      .sort((a, b) => b.outstanding - a.outstanding)
      .map((r) => [r.admission, r.name, r.grade, r.section, String(r.overdue), fromMinor(r.outstanding)]),
  };
}

async function staffDirectory(scope: AnalyticsScope): Promise<ReportRows> {
  const staff = await db.staff.findMany({
    where: { organizationId: scope.organizationId, branchId: scope.branchId, deletedAt: null, exitDate: null },
    include: { user: true, department: true, position: true },
    orderBy: { employeeCode: "asc" },
  });
  // Deliberately no pay column: this report requires sis.staff:view, which
  // is NOT hr.compensation:view, and a report must not become a way to read
  // a field the viewer's permissions don't reach.
  return {
    header: ["employee_code", "name", "email", "department", "position", "joined"],
    rows: staff.map((s) => [
      s.employeeCode,
      s.user.name,
      s.user.email,
      s.department?.name ?? "",
      s.position?.title ?? s.designation,
      s.joinDate.toISOString().slice(0, 10),
    ]),
  };
}

async function admissionsFunnel(scope: AnalyticsScope): Promise<ReportRows> {
  const leads = await db.lead.findMany({
    where: { branchId: scope.branchId, deletedAt: null },
    include: { source: true },
  });
  const bySource = new Map<string, Record<string, number>>();
  for (const l of leads) {
    const key = l.source?.name ?? "Direct";
    const row = bySource.get(key) ?? { leads: 0, CONTACTED: 0, QUALIFIED: 0, APPLIED: 0, ADMITTED: 0, LOST: 0 };
    row.leads += 1;
    if (l.stage in row) row[l.stage] += 1;
    bySource.set(key, row);
  }
  return {
    header: ["source", "leads", "contacted", "qualified", "applied", "admitted", "lost", "conversion"],
    rows: [...bySource.entries()]
      .sort((a, b) => b[1].leads - a[1].leads)
      .map(([source, r]) => [
        source,
        String(r.leads),
        String(r.CONTACTED),
        String(r.QUALIFIED),
        String(r.APPLIED),
        String(r.ADMITTED),
        String(r.LOST),
        rate(r.ADMITTED, r.leads),
      ]),
  };
}
