import type { Action } from "@/lib/permissions";

/**
 * The report catalogue (blueprint Phase 11: "dashboards, report builder,
 * scheduled reports").
 *
 * A report is a DECLARATION, not a query string. The alternative — letting a
 * user compose filters and columns that become SQL — is how reporting tools
 * become a way to read tables the user's role would never open directly. So
 * each report names exactly one permission, one fixed column set and one
 * builder function; nothing about the shape is user-supplied except the
 * parameters each report declares.
 *
 * That costs flexibility. It buys a reporting layer that cannot be turned
 * into an exfiltration tool by someone who understands URLs, and it means
 * "who can run this?" has an answer you can read off the definition.
 */

export type ReportParamKind = "date_range" | "section" | "none";

export interface ReportDef {
  key: string;
  name: string;
  description: string;
  requires: { module: string; action: Action };
  params: ReportParamKind;
  columns: string[];
  /** Why someone would run it — shown so the catalogue reads as a menu, not a schema. */
  answers: string;
}

export const REPORTS: ReportDef[] = [
  {
    key: "students_by_section",
    name: "Students by section",
    description: "Every enrolled student with their grade, section and admission number.",
    requires: { module: "sis.students", action: "export" },
    params: "none",
    columns: ["admission_number", "name", "grade", "section", "status", "admitted"],
    answers: "Who is on roll, and where?",
  },
  {
    key: "attendance_by_section",
    name: "Attendance by section",
    description: "Attendance rate per section over a date range.",
    requires: { module: "academics.attendance", action: "view" },
    params: "date_range",
    columns: ["grade", "section", "sessions", "present", "absent", "late", "excused", "rate"],
    answers: "Which classes are losing days?",
  },
  {
    key: "fee_collection",
    name: "Fee collection",
    description: "Invoiced, collected and outstanding per grade.",
    requires: { module: "finance.invoices", action: "export" },
    params: "none",
    columns: ["grade", "invoices", "invoiced", "collected", "outstanding", "overdue_invoices"],
    answers: "Where is the money, and where isn't it?",
  },
  {
    key: "defaulters",
    name: "Fee defaulters",
    description: "Students with an overdue balance, largest first.",
    requires: { module: "finance.invoices", action: "export" },
    params: "none",
    columns: ["admission_number", "name", "grade", "section", "overdue_invoices", "outstanding"],
    answers: "Who should the office call today?",
  },
  {
    key: "staff_directory",
    name: "Staff directory",
    description: "Active staff with department, position and joining date. No pay.",
    requires: { module: "sis.staff", action: "view" },
    params: "none",
    columns: ["employee_code", "name", "email", "department", "position", "joined"],
    answers: "Who works here?",
  },
  {
    key: "admissions_funnel",
    name: "Admissions funnel",
    description: "Leads by stage and source, with conversion.",
    requires: { module: "admissions.leads", action: "export" },
    params: "none",
    columns: ["source", "leads", "contacted", "qualified", "applied", "admitted", "lost", "conversion"],
    answers: "Which channels actually produce admissions?",
  },
];

export const REPORT_BY_KEY = new Map(REPORTS.map((r) => [r.key, r]));

export function reportFor(key: string): ReportDef | null {
  return REPORT_BY_KEY.get(key) ?? null;
}

/** Rate as a percentage string, or an em-dash when the denominator is zero. */
export function rate(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export interface DateRange {
  from: string;
  to: string;
}

export type RangeCheck = { ok: true; range: DateRange } | { ok: false; message: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A report over an unbounded range is a way to pull the whole table; cap it. */
export const MAX_RANGE_DAYS = 400;

export function parseRange(from: string | undefined, to: string | undefined, today = new Date()): RangeCheck {
  const end = to && ISO.test(to) ? to : today.toISOString().slice(0, 10);
  const defaultStart = new Date(today.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const start = from && ISO.test(from) ? from : defaultStart;
  if (start > end) return { ok: false, message: "The start date is after the end date" };
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) return { ok: false, message: `Keep the range under ${MAX_RANGE_DAYS} days` };
  return { ok: true, range: { from: start, to: end } };
}
