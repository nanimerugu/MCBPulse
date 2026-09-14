/**
 * The system role catalog from the blueprint's role model (section 4). These
 * are seeded once as organization-independent templates (`Role.organizationId
 * = null`) and then assigned to users per-organization via RoleAssignment.
 *
 * Grants accrue phase by phase: Phase 0 (foundation), Phase 1 (SIS), Phase 2
 * (Academics), Phase 3 (Admissions), Phase 4 (Finance), Phase 5 (LMS),
 * Phase 6 (Connect). Roles whose modules haven't been built yet (Librarian,
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

const ORG_ADMIN_SET = FOUNDATION_ALL.filter((key) => key !== "platform.organizations:create");

export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    key: "platform_admin",
    name: "Platform Admin",
    description: "SaaS operations: all tenants, billing, feature flags",
    permissions: [...FOUNDATION_ALL, ...SIS_ALL, ...ACADEMICS_ALL, ...ADMISSIONS_ALL, ...FINANCE_ALL, ...LMS_ALL, ...CONNECT_ALL],
  },
  {
    key: "organization_admin",
    name: "Organization Admin",
    description: "Trust/group administration across all branches",
    permissions: [...ORG_ADMIN_SET, ...SIS_ALL, ...ACADEMICS_ALL, ...ADMISSIONS_ALL, ...FINANCE_ALL, ...LMS_ALL, ...CONNECT_ALL],
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
    ],
  },
  {
    key: "teacher",
    name: "Teacher",
    description: "Teaching and assessment for assigned classes/subjects",
    permissions: ["sis.students:view", "sis.guardians:view", "academics.structure:view", ...TEACHER_ACADEMICS, ...LMS_TEACHER],
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
    ],
  },
  {
    key: "accountant",
    name: "Accountant",
    description: "Fees and finance",
    permissions: ["sis.students:view", "sis.guardians:view", ...FINANCE_ALL],
  },
  { key: "hr_manager", name: "HR Manager", description: "Employee lifecycle", permissions: ["sis.staff:view", "sis.staff:create", "sis.staff:edit", "sis.staff:delete"] },
  { key: "librarian", name: "Librarian", description: "Library operations", permissions: ["sis.students:view"] },
  { key: "transport_manager", name: "Transport Manager", description: "Routes and vehicles", permissions: ["sis.students:view"] },
  { key: "hostel_warden", name: "Hostel Warden", description: "Hostel administration", permissions: ["sis.students:view"] },
  {
    key: "counselor",
    name: "Counselor / Admission Agent",
    description: "Lead conversion, admissions CRM",
    permissions: ["sis.students:view", "sis.students:create", "sis.guardians:view", "sis.guardians:create", "academics.structure:view", ...ADMISSIONS_COUNSELOR],
  },
  { key: "parent", name: "Parent", description: "Own child/children information and actions", permissions: [] },
  { key: "student", name: "Student", description: "Own learning and profile records", permissions: [] },
  { key: "driver", name: "Driver", description: "Assigned vehicle/route execution", permissions: [] },
  { key: "visitor_security", name: "Visitor / Security", description: "Campus entry, visitor module", permissions: [] },
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
