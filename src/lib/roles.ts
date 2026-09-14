/**
 * The system role catalog from the blueprint's role model (section 4). These
 * are seeded once as organization-independent templates (`Role.organizationId
 * = null`) and then assigned to users per-organization via RoleAssignment.
 *
 * Most roles get no foundation permissions yet — their access is defined by
 * the module that introduces them (Teacher's real permissions arrive with
 * Phase 2 Academics, Accountant's with Phase 4 Finance, etc.). Only the two
 * roles that actually operate the platform today get foundation permissions.
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

const ORG_ADMIN_SET = FOUNDATION_ALL.filter(
  (key) => key !== "platform.organizations:create",
);

export const SYSTEM_ROLES: SystemRoleDef[] = [
  { key: "platform_admin", name: "Platform Admin", description: "SaaS operations: all tenants, billing, feature flags", permissions: FOUNDATION_ALL },
  { key: "organization_admin", name: "Organization Admin", description: "Trust/group administration across all branches", permissions: ORG_ADMIN_SET },
  { key: "principal", name: "Principal", description: "School leadership, cross-module school-wide access", permissions: ["tenant.branches:view", "tenant.academic_years:view", "identity.users:view", "audit.events:view"] },
  { key: "vice_principal", name: "Vice Principal", description: "Academic and operations oversight", permissions: ["tenant.branches:view", "tenant.academic_years:view"] },
  { key: "admin_front_office", name: "Admin / Front Office", description: "Daily administration: SIS, admissions, documents, visitors", permissions: [] },
  { key: "teacher", name: "Teacher", description: "Teaching and assessment for assigned classes/subjects", permissions: [] },
  { key: "class_teacher", name: "Class Teacher", description: "Class ownership: students and parent communication", permissions: [] },
  { key: "accountant", name: "Accountant", description: "Fees and finance", permissions: [] },
  { key: "hr_manager", name: "HR Manager", description: "Employee lifecycle", permissions: [] },
  { key: "librarian", name: "Librarian", description: "Library operations", permissions: [] },
  { key: "transport_manager", name: "Transport Manager", description: "Routes and vehicles", permissions: [] },
  { key: "hostel_warden", name: "Hostel Warden", description: "Hostel administration", permissions: [] },
  { key: "counselor", name: "Counselor / Admission Agent", description: "Lead conversion, admissions CRM", permissions: [] },
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
