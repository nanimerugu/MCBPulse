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
];

export function permissionKey(module: string, action: Action): string {
  return `${module}:${action}`;
}
