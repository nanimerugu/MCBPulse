/**
 * The system role catalog from the blueprint's role model (section 4). These
 * are seeded once as organization-independent templates (`Role.organizationId
 * = null`) and then assigned to users per-organization via RoleAssignment.
 *
 * Grants accrue phase by phase: Phase 0 (foundation), Phase 1 (SIS), Phase 2
 * (Academics), Phase 3 (Admissions), Phase 4 (Finance), Phase 5 (LMS),
 * Phase 6 (Connect), Phase 7 (HR), Phase 8 (Operations), Phase 9 (portal), Phase 10 (AI), Phase 11 (Analytics), Examcell. Roles whose modules haven't been built yet (Librarian,
 * Transport Manager, ...) still have view-only or empty grants.
 *
 * Teacher and Class Teacher are SECTION-SCOPED roles (see
 * SECTION_SCOPED_ROLE_KEYS in src/lib/rbac.ts): when every role granting a
 * permission is one of these, authorize() reports the grant as scoped and
 * the module restricts it to sections the teacher is assigned to.
 */
export interface SystemRoleDef {
  key: string;
  name: string;
  description: string;
  permissions: string[];
}

const FOUNDATION_ALL = [
  "platform.organizations:view",
  "platform.organizations:create",
  "platform.organizations:edit",
  "platform.organizations:configure",
  "tenant.branches:view",
  "tenant.branches:create",
  "tenant.branches:edit",
  "tenant.branches:delete",
  "tenant.academic_years:view",
  "tenant.academic_years:create",
  "tenant.academic_years:edit",
  "identity.users:view",
  "identity.users:create",
  "identity.users:edit",
  "identity.users:delete",
  "identity.roles:view",
  "identity.roles:create",
  "identity.roles:edit",
  "identity.roles:configure",
  "audit.events:view",
  "audit.events:export",
  "feature_flags:view",
  "feature_flags:configure",
];

const SIS_ALL = [
  "sis.students:view",
  "sis.students:create",
  "sis.students:edit",
  "sis.students:delete",
  "sis.students:export",
  "sis.enrollment:edit",
  "sis.guardians:view",
  "sis.guardians:create",
  "sis.guardians:edit",
  "sis.guardians:delete",
  "sis.staff:view",
  "sis.staff:create",
  "sis.staff:edit",
  "sis.staff:delete",
  "academics.structure:view",
  "academics.structure:configure",
];
const SIS_READ = ["sis.students:view", "sis.guardians:view", "sis.staff:view", "academics.structure:view"];

const ACADEMICS_ALL = [
  "academics.subjects:view",
  "academics.subjects:configure",
  "academics.assignments:view",
  "academics.assignments:configure",
  "academics.timetable:view",
  "academics.timetable:configure",
  "academics.attendance:view",
  "academics.attendance:create",
  "academics.attendance:edit",
  "academics.attendance:approve",
];
const ACADEMICS_READ = ["academics.subjects:view", "academics.assignments:view", "academics.timetable:view", "academics.attendance:view"];
const TEACHER_ACADEMICS = [...ACADEMICS_READ, "academics.attendance:create", "academics.attendance:edit"];

const ADMISSIONS_ALL = [
  "admissions.leads:view",
  "admissions.leads:create",
  "admissions.leads:edit",
  "admissions.leads:configure",
  "admissions.leads:export",
  "admissions.applications:view",
  "admissions.applications:create",
  "admissions.applications:edit",
  "admissions.applications:approve",
  "admissions.settings:view",
  "admissions.settings:configure",
];
/** The counselor's day job: everything except the admit/reject decision and settings. */
const ADMISSIONS_COUNSELOR = [
  "admissions.leads:view",
  "admissions.leads:create",
  "admissions.leads:edit",
  "admissions.leads:configure",
  "admissions.leads:export",
  "admissions.applications:view",
  "admissions.applications:create",
  "admissions.applications:edit",
  "admissions.settings:view",
];
const ADMISSIONS_READ = ["admissions.leads:view", "admissions.applications:view", "admissions.settings:view"];

const FINANCE_ALL = [
  "finance.fee_structures:view",
  "finance.fee_structures:configure",
  "finance.concessions:view",
  "finance.concessions:approve",
  "finance.invoices:view",
  "finance.invoices:create",
  "finance.invoices:edit",
  "finance.invoices:export",
  "finance.payments:view",
  "finance.payments:pay",
  "finance.payments:refund",
  "finance.ledger:view",
];
const FINANCE_READ = ["finance.fee_structures:view", "finance.concessions:view", "finance.invoices:view", "finance.payments:view"];
/** A front-office cashier: sees dues, takes money, issues receipts. No refunds, no structure changes. */
const FINANCE_CASHIER = ["finance.invoices:view", "finance.payments:view", "finance.payments:pay"];

const LMS_ALL = [
  "lms.courses:view",
  "lms.courses:create",
  "lms.courses:edit",
  "lms.assignments:view",
  "lms.assignments:create",
  "lms.assignments:edit",
  "lms.assignments:publish",
  "lms.grades:view",
  "lms.grades:edit",
  "lms.grades:export",
];
/** A teacher authors and grades their own sections' work; scoping does the limiting. */
const LMS_TEACHER = [
  "lms.courses:view",
  "lms.courses:create",
  "lms.courses:edit",
  "lms.assignments:view",
  "lms.assignments:create",
  "lms.assignments:edit",
  "lms.assignments:publish",
  "lms.grades:view",
  "lms.grades:edit",
];
const LMS_READ = ["lms.courses:view", "lms.assignments:view", "lms.grades:view"];

const CONNECT_ALL = [
  "connect.templates:view",
  "connect.templates:create",
  "connect.templates:edit",
  "connect.broadcasts:view",
  "connect.broadcasts:create",
  "connect.broadcasts:message",
  "connect.delivery:view",
  "connect.delivery:export",
  "connect.settings:view",
  "connect.settings:configure",
];
/** Front office drafts and sends day-to-day notices; it does not reshape policy. */
const CONNECT_SENDER = [
  "connect.templates:view",
  "connect.broadcasts:view",
  "connect.broadcasts:create",
  "connect.broadcasts:message",
  "connect.delivery:view",
  "connect.settings:view",
];
const CONNECT_READ = ["connect.templates:view", "connect.broadcasts:view", "connect.delivery:view"];

const HR_ALL = [
  "hr.org:view",
  "hr.org:configure",
  "hr.compensation:view",
  "hr.compensation:edit",
  "hr.leave:view",
  "hr.leave:create",
  "hr.leave:approve",
  "hr.payroll:view",
  "hr.payroll:create",
  "hr.payroll:approve",
  "hr.payroll:export",
  "hr.appraisals:view",
  "hr.appraisals:edit",
  "hr.exit:edit",
];
/** A head teacher sees the org chart and signs off leave; pay is not theirs to see. */
const HR_LEADERSHIP = ["hr.org:view", "hr.leave:view", "hr.leave:create", "hr.leave:approve", "hr.appraisals:view", "hr.appraisals:edit"];
/**
 * Anyone on staff can see the org chart — who is in which department is not
 * confidential inside a school.
 *
 * Deliberately NOT including hr.leave here. "Let a teacher file their own
 * leave" needs an attribute policy that scopes hr.leave to the requester's
 * own staff record, and that policy doesn't exist yet (same missing piece as
 * the student/parent portal's "own records only"). Granting hr.leave:view
 * without it would let every teacher read every colleague's leave history,
 * and hr.leave:create would let them file leave in someone else's name.
 * Until the scope exists, staff leave stays with HR and school leadership.
 */
const HR_SELF = ["hr.org:view"];

const OPS_LIBRARY = ["ops.library:view", "ops.library:create", "ops.library:edit"];
const OPS_INVENTORY = ["ops.inventory:view", "ops.inventory:create", "ops.inventory:edit"];
const OPS_TRANSPORT = ["ops.transport:view", "ops.transport:configure", "ops.transport:edit"];
const OPS_HOSTEL = ["ops.hostel:view", "ops.hostel:configure", "ops.hostel:edit"];
const OPS_VISITORS = ["ops.visitors:view", "ops.visitors:edit"];
const OPS_INFIRMARY = ["ops.infirmary:view", "ops.infirmary:edit"];
const OPS_ALL = [...OPS_LIBRARY, ...OPS_INVENTORY, ...OPS_TRANSPORT, ...OPS_HOSTEL, ...OPS_VISITORS, ...OPS_INFIRMARY];
/** Leadership sees how the campus is running without operating it. */
const EXAMS_ALL = ["exams.banks:view", "exams.banks:create", "exams.banks:edit", "exams.exams:view", "exams.exams:create", "exams.exams:publish", "exams.exams:edit"];
/** A teacher writes questions, builds papers and marks; publishing is theirs too, scoped to their sections. */
const EXAMS_TEACHER = EXAMS_ALL;
const EXAMS_READ = ["exams.banks:view", "exams.exams:view"];

const ANALYTICS_ALL = ["analytics.dashboard:view", "analytics.reports:view", "analytics.reports:export"];
const ANALYTICS_READ = ["analytics.dashboard:view", "analytics.reports:view"];

const AI_ALL = ["ai.console:view", "ai.usage:view"];

const OPS_READ = ["ops.library:view", "ops.inventory:view", "ops.transport:view", "ops.hostel:view", "ops.visitors:view"];

const ORG_ADMIN_SET = FOUNDATION_ALL.filter((key) => key !== "platform.organizations:create");

export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    key: "platform_admin",
    name: "Platform Admin",
    description: "SaaS operations: all tenants, billing, feature flags",
    permissions: [...FOUNDATION_ALL, ...SIS_ALL, ...ACADEMICS_ALL, ...ADMISSIONS_ALL, ...FINANCE_ALL, ...LMS_ALL, ...CONNECT_ALL, ...HR_ALL, ...OPS_ALL, ...AI_ALL, ...ANALYTICS_ALL, ...EXAMS_ALL],
  },
  {
    key: "organization_admin",
    name: "Organization Admin",
    description: "Trust/group administration across all branches",
    permissions: [...ORG_ADMIN_SET, ...SIS_ALL, ...ACADEMICS_ALL, ...ADMISSIONS_ALL, ...FINANCE_ALL, ...LMS_ALL, ...CONNECT_ALL, ...HR_ALL, ...OPS_ALL, ...AI_ALL, ...ANALYTICS_ALL, ...EXAMS_ALL],
  },
  {
    key: "principal",
    name: "Principal",
    description: "School leadership, cross-module school-wide access",
    permissions: [
      "tenant.branches:view",
      "tenant.academic_years:view",
      "identity.users:view",
      "audit.events:view",
      ...SIS_READ,
      "sis.students:edit",
      "sis.students:export",
      "sis.enrollment:edit",
      "sis.guardians:edit",
      "academics.structure:configure",
      ...ACADEMICS_ALL,
      ...ADMISSIONS_ALL,
      ...FINANCE_READ,
      "finance.concessions:approve",
      "finance.payments:refund",
      "finance.ledger:view",
      ...LMS_READ,
      "lms.grades:export",
      ...CONNECT_ALL,
      ...HR_LEADERSHIP,
      "hr.payroll:view",
      ...OPS_ALL,
      ...AI_ALL,
      ...ANALYTICS_ALL,
      ...EXAMS_ALL,
    ],
  },
  {
    key: "vice_principal",
    name: "Vice Principal",
    description: "Academic and operations oversight",
    permissions: [
      "tenant.branches:view",
      "tenant.academic_years:view",
      ...SIS_READ,
      "sis.enrollment:edit",
      ...ACADEMICS_READ,
      "academics.timetable:configure",
      "academics.assignments:configure",
      "academics.attendance:approve",
      ...ADMISSIONS_READ,
      "admissions.applications:approve",
      ...FINANCE_READ,
      ...LMS_READ,
      "lms.grades:export",
      ...CONNECT_SENDER,
      ...HR_LEADERSHIP,
      ...OPS_READ,
      ...ANALYTICS_READ,
      ...EXAMS_READ,
    ],
  },
  {
    key: "admin_front_office",
    name: "Admin / Front Office",
    description: "Daily administration: SIS, admissions, documents, visitors",
    permissions: [
      ...SIS_READ,
      "sis.students:create",
      "sis.students:edit",
      "sis.students:export",
      "sis.enrollment:edit",
      "sis.guardians:create",
      "sis.guardians:edit",
      "sis.guardians:delete",
      ...ACADEMICS_READ,
      ...ADMISSIONS_COUNSELOR,
      ...FINANCE_CASHIER,
      ...LMS_READ,
      ...CONNECT_SENDER,
      ...HR_SELF,
      "ops.library:view",
      "ai.console:view",
      ...EXAMS_TEACHER,
    ],
  },
  {
    key: "teacher",
    name: "Teacher",
    description: "Teaching and assessment for assigned classes/subjects",
    permissions: ["sis.students:view", "sis.guardians:view", "academics.structure:view", ...TEACHER_ACADEMICS, ...LMS_TEACHER, ...HR_SELF, "ai.console:view", ...EXAMS_TEACHER],
  },
  {
    key: "class_teacher",
    name: "Class Teacher",
    description: "Class ownership: students and parent communication",
    permissions: [
      "sis.students:view",
      "sis.guardians:view",
      "academics.structure:view",
      ...TEACHER_ACADEMICS,
      "academics.attendance:approve",
      ...LMS_TEACHER,
      "lms.grades:export",
      ...CONNECT_READ,
      "connect.broadcasts:create",
      "connect.broadcasts:message",
      ...HR_SELF,
    ],
  },
  {
    key: "accountant",
    name: "Accountant",
    description: "Fees and finance",
    permissions: ["sis.students:view", "sis.guardians:view", ...FINANCE_ALL, ...ANALYTICS_ALL],
  },
  { key: "hr_manager", name: "HR Manager", description: "Employee lifecycle", permissions: ["sis.staff:view", "sis.staff:create", "sis.staff:edit", "sis.staff:delete", ...HR_ALL] },
  { key: "librarian", name: "Librarian", description: "Library operations", permissions: ["sis.students:view", "sis.staff:view", ...OPS_LIBRARY] },
  { key: "transport_manager", name: "Transport Manager", description: "Routes and vehicles", permissions: ["sis.students:view", ...OPS_TRANSPORT] },
  { key: "hostel_warden", name: "Hostel Warden", description: "Hostel administration", permissions: ["sis.students:view", ...OPS_HOSTEL, ...OPS_INFIRMARY] },
  {
    key: "counselor",
    name: "Counselor / Admission Agent",
    description: "Lead conversion, admissions CRM",
    permissions: ["sis.students:view", "sis.students:create", "sis.guardians:view", "sis.guardians:create", "academics.structure:view", ...ADMISSIONS_COUNSELOR],
  },
  {
    key: "parent",
    name: "Parent",
    description: "Own child/children information and actions",
    // SELF-SCOPED (see SELF_SCOPED_ROLE_KEYS in rbac.ts). These are the same
    // permission keys staff hold, narrowed to this parent's own children by
    // the attribute policy. The staff gate REFUSES a self-scoped decision, so
    // these never open a staff screen — they only feed /portal.
    permissions: ["sis.students:view", "academics.attendance:view", "academics.timetable:view", "finance.invoices:view", "lms.assignments:view", "lms.grades:view", "ops.infirmary:view", "ops.transport:view"],
  },
  {
    key: "student",
    name: "Student",
    description: "Own learning and profile records",
    // Self-scoped to their own record. No finance: a child does not need to
    // see what their family owes.
    permissions: ["sis.students:view", "academics.attendance:view", "academics.timetable:view", "lms.assignments:view", "lms.grades:view"],
  },
  {
    key: "driver",
    name: "Driver",
    description: "Assigned vehicle/route execution",
    // Self-scoped to the students on the vehicle they drive. A manifest is a
    // list of names and stops, so ops.transport:view is the whole grant.
    permissions: ["ops.transport:view"],
  },
  { key: "visitor_security", name: "Visitor / Security", description: "Campus entry, visitor module", permissions: ["sis.students:view", ...OPS_VISITORS] },
  { key: "alumni", name: "Alumni", description: "Alumni portal, own profile/community", permissions: [] },
];

export function assertKnownPermissionKeys(allKeys: Set<string>) {
  for (const role of SYSTEM_ROLES) {
    for (const key of role.permissions) {
      if (!allKeys.has(key)) {
        throw new Error(
          `Role "${role.key}" references unknown permission "${key}". Add it to src/lib/permissions.ts first.`,
        );
      }
    }
  }
}
