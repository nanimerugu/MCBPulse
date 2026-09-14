import { EmptyState } from "@/components/ui";
import type { SisAccessResult } from "@/modules/sis/access";

/** Renders the reason a SIS page couldn't load, in words the person can act on. */
export function AccessDenied({ result, permission }: { result: Extract<SisAccessResult, { ok: false }>; permission: string }) {
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
          The Student Information System (<code className="text-xs">phase1.sis</code>) is switched off for this
          organization.
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
