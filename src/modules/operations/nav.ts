import type { Action } from "@/lib/permissions";

/**
 * The permissions that entitle someone to the Operations landing page —
 * holding ANY one of them is enough, because the module is six independent
 * sub-modules and most of the people who work in it hold exactly one.
 *
 * Kept here so the nav item (src/components/app-shell.tsx) and the page gate
 * can't drift apart the way the nav's flag list did in Phase 7.
 */
export const OPS_LANDING_PERMISSIONS: readonly { module: string; action: Action }[] = [
  { module: "ops.library", action: "view" },
  { module: "ops.inventory", action: "view" },
  { module: "ops.transport", action: "view" },
  { module: "ops.hostel", action: "view" },
  { module: "ops.visitors", action: "view" },
  { module: "ops.infirmary", action: "view" },
  { module: "ops.canteen", action: "view" },
];

export const OPS_LANDING_PERMISSION_KEYS: readonly string[] = OPS_LANDING_PERMISSIONS.map((p) => `${p.module}:${p.action}`);
