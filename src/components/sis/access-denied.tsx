import { EmptyState } from "@/components/ui";
import type { ModuleAccessResult } from "@/modules/sis/access";

const FLAG_NAMES: Record<string, string> = {
  "phase1.sis": "Student Information System",
  "phase2.academics": "Academics",
  "phase3.admissions": "Admissions",
  "phase4.finance": "Finance",
  "phase5.lms": "Learning management",
  "phase6.connect": "Communication",
};

/** Renders the reason a module page couldn't load, in words the person can act on. */
export function AccessDenied({ result, permission }: { result: Extract<ModuleAccessResult, { ok: false }>; permission: string }) {
  switch (result.reason) {
    case "no_branch":
      return (
        <EmptyState>
          You don&apos;t have a branch to work in yet. Either your organization has no branches, or none of your role
          assignments cover one — an Organization Admin can fix either.
        </EmptyState>
      );
    case "feature_disabled":
      return (
        <EmptyState>
          {FLAG_NAMES[result.flag] ?? "This module"} (<code className="text-xs">{result.flag}</code>) is switched off for
          this organization.
        </EmptyState>
      );
    case "forbidden":
      return (
        <EmptyState>
          You don&apos;t have permission to do this here (<code className="text-xs">{permission}</code>
          {result.ctx ? ` in ${result.ctx.branch.name}` : ""}).
        </EmptyState>
      );
  }
}
