/**
 * The Phase 0 permission catalog. Every entry here is a `module:action` pair
 * (blueprint section 5's explicit action verbs). This file is the single
 * source of truth: the seed script writes these rows into the Permission
 * table, and RBAC checks reference the same keys, so a typo shows up at
 * compile time instead of as a silent always-denied check in production.
 *
 * Only foundation-layer modules are listed. Each later phase (SIS, Finance,
 * Admissions, ...) adds its own module's permissions when it lands — see
 * docs/architecture-blueprint-raw.md section 20 for the phase order.
 */

export const ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  "publish",
  "export",
  "message",
  "pay",
  "refund",
  "configure",
] as const;
export type Action = (typeof ACTIONS)[number];

export interface PermissionDef {
  module: string;
  action: Action;
  description: string;
}

export const PERMISSIONS: PermissionDef[] = [
  { module: "platform.organizations", action: "view", description: "View organizations (trusts/groups)" },
  { module: "platform.organizations", action: "create", description: "Create a new organization" },
  { module: "platform.organizations", action: "edit", description: "Edit organization settings" },
  { module: "platform.organizations", action: "configure", description: "Configure plan/billing/feature flags for an organization" },

  { module: "tenant.branches", action: "view", description: "View branches/campuses" },
  { module: "tenant.branches", action: "create", description: "Create a branch/campus" },
  { module: "tenant.branches", action: "edit", description: "Edit a branch/campus" },
  { module: "tenant.branches", action: "delete", description: "Archive/close a branch" },

  { module: "tenant.academic_years", action: "view", description: "View academic years" },
  { module: "tenant.academic_years", action: "create", description: "Create an academic year" },
  { module: "tenant.academic_years", action: "edit", description: "Edit an academic year" },

  { module: "identity.users", action: "view", description: "View users" },
  { module: "identity.users", action: "create", description: "Invite/create a user" },
  { module: "identity.users", action: "edit", description: "Edit a user" },
  { module: "identity.users", action: "delete", description: "Disable a user" },

  { module: "identity.roles", action: "view", description: "View roles and role assignments" },
  { module: "identity.roles", action: "create", description: "Create a custom role" },
  { module: "identity.roles", action: "edit", description: "Edit a role's permissions" },
  { module: "identity.roles", action: "configure", description: "Assign/revoke a role for a user" },

  { module: "audit.events", action: "view", description: "View the audit log" },
  { module: "audit.events", action: "export", description: "Export audit log records" },

  { module: "feature_flags", action: "view", description: "View feature flag state" },
  { module: "feature_flags", action: "configure", description: "Override a feature flag for an organization" },

  // --- Phase 1: SIS ---------------------------------------------------------
  { module: "sis.students", action: "view", description: "View student records and the Student 360 profile" },
  { module: "sis.students", action: "create", description: "Create student records, including bulk CSV import" },
  { module: "sis.students", action: "edit", description: "Edit student profile details" },
  { module: "sis.students", action: "delete", description: "Archive (soft-delete) a student record" },
  { module: "sis.students", action: "export", description: "Export student data as CSV" },

  // One permission covers every lifecycle transition (enroll, promote,
  // transfer, withdraw, graduate). Splitting them per-verb would only matter
  // once an approval workflow exists — that's the section-12 engine's job.
  { module: "sis.enrollment", action: "edit", description: "Change a student's enrollment: enroll, promote, transfer, withdraw, graduate" },

  { module: "sis.guardians", action: "view", description: "View guardians and their links to students" },
  { module: "sis.guardians", action: "create", description: "Create a guardian and link them to a student" },
  { module: "sis.guardians", action: "edit", description: "Edit a guardian or a guardian link" },
  { module: "sis.guardians", action: "delete", description: "Unlink a guardian from a student" },

  { module: "sis.staff", action: "view", description: "View staff records" },
  { module: "sis.staff", action: "create", description: "Create a staff record and its login" },
  { module: "sis.staff", action: "edit", description: "Edit a staff record" },
  { module: "sis.staff", action: "delete", description: "Mark a staff member as exited" },

  { module: "academics.structure", action: "view", description: "View grades and sections" },
  { module: "academics.structure", action: "configure", description: "Create and edit grades and sections" },

  // --- Phase 2: Academics ---------------------------------------------------
  { module: "academics.subjects", action: "view", description: "View subjects and curricula" },
  { module: "academics.subjects", action: "configure", description: "Create and edit subjects and curricula" },

  { module: "academics.assignments", action: "view", description: "View which teacher takes which subject in which section" },
  { module: "academics.assignments", action: "configure", description: "Assign or unassign a teacher to a section's subject" },

  { module: "academics.timetable", action: "view", description: "View section and teacher timetables" },
  { module: "academics.timetable", action: "configure", description: "Add or remove timetable slots" },

  { module: "academics.attendance", action: "view", description: "View attendance and attendance summaries" },
  { module: "academics.attendance", action: "create", description: "Take attendance for a section" },
  { module: "academics.attendance", action: "edit", description: "Correct attendance while the session is still unlocked" },
  { module: "academics.attendance", action: "approve", description: "Lock/unlock sessions, correct after lock, approve or reject student leave" },

  // --- Phase 3: Admissions --------------------------------------------------
  { module: "admissions.leads", action: "view", description: "View leads and the admissions funnel" },
  { module: "admissions.leads", action: "create", description: "Create a lead" },
  { module: "admissions.leads", action: "edit", description: "Edit a lead, add notes, set follow-ups" },
  { module: "admissions.leads", action: "configure", description: "Move a lead through the pipeline and assign counselors" },
  { module: "admissions.leads", action: "export", description: "Export leads as CSV" },

  { module: "admissions.applications", action: "view", description: "View applications, documents and appointments" },
  { module: "admissions.applications", action: "create", description: "Open an application for a lead" },
  { module: "admissions.applications", action: "edit", description: "Update documents, appointments, and move to review" },
  { module: "admissions.applications", action: "approve", description: "Offer, waitlist, accept or reject an application; convert an accepted one into a student" },

  { module: "admissions.settings", action: "view", description: "View lead sources and campaigns" },
  { module: "admissions.settings", action: "configure", description: "Manage lead sources and campaigns" },

  // --- Phase 4: Finance -----------------------------------------------------
  { module: "finance.fee_structures", action: "view", description: "View fee heads and fee structures" },
  { module: "finance.fee_structures", action: "configure", description: "Create fee heads and fee structures" },

  { module: "finance.concessions", action: "view", description: "View concessions" },
  { module: "finance.concessions", action: "approve", description: "Grant a concession to a student" },

  { module: "finance.invoices", action: "view", description: "View invoices and dues" },
  { module: "finance.invoices", action: "create", description: "Raise invoices from a fee structure" },
  { module: "finance.invoices", action: "edit", description: "Cancel an unpaid invoice" },
  { module: "finance.invoices", action: "export", description: "Export dues and collections" },

  { module: "finance.payments", action: "view", description: "View payments and receipts" },
  { module: "finance.payments", action: "pay", description: "Record a payment and issue a receipt" },
  { module: "finance.payments", action: "refund", description: "Approve and process refunds" },

  { module: "finance.ledger", action: "view", description: "View the chart of accounts and journal" },

  // --- Phase 5: LMS ---------------------------------------------------------
  { module: "lms.courses", action: "view", description: "View courses, modules and lessons" },
  { module: "lms.courses", action: "create", description: "Create a course, module or lesson" },
  { module: "lms.courses", action: "edit", description: "Edit course content" },

  { module: "lms.assignments", action: "view", description: "View assignments" },
  { module: "lms.assignments", action: "create", description: "Create an assignment for a section" },
  { module: "lms.assignments", action: "edit", description: "Edit or delete an unpublished assignment" },
  { module: "lms.assignments", action: "publish", description: "Publish an assignment to a section" },

  { module: "lms.grades", action: "view", description: "View submissions and the gradebook" },
  { module: "lms.grades", action: "edit", description: "Record submissions, marks and feedback" },
  { module: "lms.grades", action: "export", description: "Export the gradebook as CSV" },

  // --- Phase 6: Connect -----------------------------------------------------
  { module: "connect.templates", action: "view", description: "View message templates" },
  { module: "connect.templates", action: "create", description: "Create a message template" },
  { module: "connect.templates", action: "edit", description: "Edit a message template" },

  { module: "connect.broadcasts", action: "view", description: "View broadcasts and their audiences" },
  { module: "connect.broadcasts", action: "create", description: "Draft a broadcast" },
  { module: "connect.broadcasts", action: "message", description: "Send a broadcast to its audience" },

  { module: "connect.delivery", action: "view", description: "View the delivery log" },
  { module: "connect.delivery", action: "export", description: "Export the delivery log" },

  { module: "connect.settings", action: "view", description: "View quiet hours and consent settings" },
  { module: "connect.settings", action: "configure", description: "Set quiet hours and guardian opt-outs" },

  // --- Phase 7: HR ----------------------------------------------------------
  { module: "hr.org", action: "view", description: "View departments and positions" },
  { module: "hr.org", action: "configure", description: "Create departments and positions, and assign staff to them" },

  { module: "hr.compensation", action: "view", description: "View staff salaries" },
  { module: "hr.compensation", action: "edit", description: "Set a staff member's monthly gross pay" },

  { module: "hr.leave", action: "view", description: "View staff leave requests" },
  { module: "hr.leave", action: "create", description: "Record a staff leave request" },
  { module: "hr.leave", action: "approve", description: "Approve or reject staff leave" },

  { module: "hr.payroll", action: "view", description: "View payroll runs and payslips" },
  { module: "hr.payroll", action: "create", description: "Open a payroll run and generate payslips" },
  { module: "hr.payroll", action: "approve", description: "Process a payroll run and mark it paid" },
  { module: "hr.payroll", action: "export", description: "Export a payroll run as CSV" },

  { module: "hr.appraisals", action: "view", description: "View staff appraisals" },
  { module: "hr.appraisals", action: "edit", description: "Record a staff appraisal" },

  { module: "hr.exit", action: "edit", description: "Record a staff exit" },

  // --- Phase 8: Operations --------------------------------------------------
  { module: "ops.library", action: "view", description: "View the library catalogue and loans" },
  { module: "ops.library", action: "create", description: "Add a title to the catalogue" },
  { module: "ops.library", action: "edit", description: "Edit a title, issue and return copies" },

  { module: "ops.inventory", action: "view", description: "View stock levels and movements" },
  { module: "ops.inventory", action: "create", description: "Add an inventory item" },
  { module: "ops.inventory", action: "edit", description: "Record a stock movement" },

  { module: "ops.transport", action: "view", description: "View vehicles, routes and stops" },
  { module: "ops.transport", action: "configure", description: "Manage vehicles, routes and stops" },
  { module: "ops.transport", action: "edit", description: "Allocate a student to a route and stop" },

  { module: "ops.hostel", action: "view", description: "View hostel blocks, rooms and occupancy" },
  { module: "ops.hostel", action: "configure", description: "Manage hostel blocks and rooms" },
  { module: "ops.hostel", action: "edit", description: "Allocate a student to a room, or check them out" },

  { module: "ops.visitors", action: "view", description: "View the gate register" },
  { module: "ops.visitors", action: "edit", description: "Check a visitor in or out" },

  // Health information about a child, so it is never folded into a general
  // student-view grant — a class teacher who can see a timetable has no
  // automatic business reading medical complaints.
  { module: "ops.infirmary", action: "view", description: "View infirmary visits" },
  { module: "ops.infirmary", action: "edit", description: "Record an infirmary visit" },

  // --- Phase 10: AI --------------------------------------------------------
  // Using an AI capability ALSO requires the permission guarding the records
  // it touches (see src/modules/ai/capabilities.ts) — this pair only decides
  // who may open the AI console and who may see what it has cost.
  { module: "ai.console", action: "view", description: "Open the AI assistant" },
  { module: "ai.usage", action: "view", description: "View AI usage, cost and generation history" },

  // --- Phase 11: Analytics -------------------------------------------------
  // Opening the dashboard is one permission; each REPORT additionally
  // requires the permission of the module it reads (see
  // src/modules/analytics/reports.ts), so reporting can never widen access.
  { module: "analytics.dashboard", action: "view", description: "View cross-module dashboards" },
  { module: "analytics.reports", action: "view", description: "Open the report catalogue" },
  { module: "analytics.reports", action: "export", description: "Download a report as CSV" },
];

export function permissionKey(module: string, action: Action): string {
  return `${module}:${action}`;
}
