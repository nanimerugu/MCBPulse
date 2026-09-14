import { getViewerContext } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/feature-flags";

export default async function DashboardPage() {
  const viewer = await getViewerContext();
  if (!viewer) return null; // layout already redirects; this satisfies TS

  const sisEnabled = await isFeatureEnabled("phase1.sis", viewer.organizationId);
  const aiEnabled = await isFeatureEnabled("ai.copilot", viewer.organizationId);

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Welcome, {viewer.name}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Phase 0 (tenancy, identity, RBAC, audit, feature flags) and Phase 1 (students, guardians, staff, academic
          structure) are live. Everything else in the nav is a placeholder for the phase that builds it.
        </p>
      </div>

      <section className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-700 dark:border-zinc-800 dark:text-zinc-200">
          Your role assignments
        </h2>
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {viewer.assignments.length === 0 ? (
            <li className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">No role assignments yet.</li>
          ) : (
            viewer.assignments.map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5 px-4 py-3 text-sm">
                <span className="font-medium text-zinc-900 dark:text-zinc-50">{a.role.name}</span>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {a.organization.name}
                  {a.branch ? ` · ${a.branch.name}` : " · all branches"}
                  {a.academicYear ? ` · ${a.academicYear.name}` : " · all years"}
                </span>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-700 dark:border-zinc-800 dark:text-zinc-200">
          Feature flags (this organization)
        </h2>
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          <FlagRow flagKey="phase1.sis" label="Student Information System (Phase 1)" enabled={sisEnabled} />
          <FlagRow flagKey="ai.copilot" label="AI Gateway / school copilot (Phase 10)" enabled={aiEnabled} />
        </ul>
      </section>
    </div>
  );
}

function FlagRow({ flagKey, label, enabled }: { flagKey: string; label: string; enabled: boolean }) {
  return (
    <li className="flex items-center justify-between px-4 py-3 text-sm">
      <div>
        <p className="text-zinc-900 dark:text-zinc-50">{label}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{flagKey}</p>
      </div>
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
          enabled
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
        }`}
      >
        {enabled ? "Enabled" : "Disabled"}
      </span>
    </li>
  );
}
