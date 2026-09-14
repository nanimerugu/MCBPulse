/**
 * The system role catalog from the blueprint's role model (section 4). These
 * are seeded once as organization-independent templates (`Role.organizationId
 * = null`) and then assigned to users per-organization via RoleAssignment.
 *
 * Grants accrue phase by phase: Phase 0 gave the two platform-operating roles
 * the foundation permissions; Phase 1 (SIS) adds the school-facing roles'
 * first real permissions. Roles whose modules haven't been built yet
 * (Accountant → Finance, Librarian → Library, ...) still have empty grants.
 *
 * Teacher and Class Teacher can *view* students org-wide here. The
 * blueprint's "assigned classes only" restriction is the attribute-policy
 * stage of authorize(), which lands with Phase 2 Academics once there's a
 * subject-assignment to scope by. Until then this is deliberately permissive
 * rather than silently broken.
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

const SIS_READ = [
  "sis.students:view",
  "sis.guardians:view",
  "sis.staff:view",
  "academics.structure:view",
];

const ORG_ADMIN_SET = FOUNDATION_ALL.filter((key) => key !== "platform.organizations:create");

export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    key: "platform_admin",
    name: "Platform Admin",
    description: "SaaS operations: all tenants, billing, feature flags",
    permissions: [...FOUNDATION_ALL, ...SIS_ALL],
  },
  {
    key: "organization_admin",
    name: "Organization Admin",
    description: "Trust/group administration across all branches",
    permissions: [...ORG_ADMIN_SET, ...SIS_ALL],
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
    ],
  },
  {
    key: "vice_principal",
    name: "Vice Principal",
    description: "Academic and operations oversight",
    permissions: ["tenant.branches:view", "tenant.academic_years:view", ...SIS_READ, "sis.enrollment:edit"],
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
    ],
  },
  { key: "teacher", name: "Teacher", description: "Teaching and assessment for assigned classes/subjects", permissions: ["sis.students:view", "sis.guardians:view", "academics.structure:view"] },
  { key: "class_teacher", name: "Class Teacher", description: "Class ownership: students and parent communication", permissions: ["sis.students:view", "sis.guardians:view", "academics.structure:view"] },
  { key: "accountant", name: "Accountant", description: "Fees and finance", permissions: ["sis.students:view"] },
  { key: "hr_manager", name: "HR Manager", description: "Employee lifecycle", permissions: ["sis.staff:view", "sis.staff:create", "sis.staff:edit", "sis.staff:delete"] },
  { key: "librarian", name: "Librarian", description: "Library operations", permissions: ["sis.students:view"] },
  { key: "transport_manager", name: "Transport Manager", description: "Routes and vehicles", permissions: ["sis.students:view"] },
  { key: "hostel_warden", name: "Hostel Warden", description: "Hostel administration", permissions: ["sis.students:view"] },
  { key: "counselor", name: "Counselor / Admission Agent", description: "Lead conversion, admissions CRM", permissions: ["sis.students:view", "sis.students:create", "sis.guardians:view", "sis.guardians:create"] },
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
