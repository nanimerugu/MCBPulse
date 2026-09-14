import Link from "next/link";
import { getViewerContext } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { resolveBranchContext, withBranch } from "@/lib/branch-context";
import { Badge, Card, EmptyState } from "@/components/ui";
import { getStaffForViewer } from "@/modules/academics/scope";
import { todaysSlotsForStaff } from "@/modules/academics/timetable.service";
import { pendingSectionsForStaff } from "@/modules/academics/attendance.service";
import { DAY_LABELS, dayOfWeekFor } from "@/modules/academics/timetable-conflicts";

export default async function DashboardPage() {
  const viewer = await getViewerContext();
  if (!viewer) return null; // layout already redirects; this satisfies TS

  const [sisEnabled, academicsEnabled, aiEnabled] = await Promise.all([
    isFeatureEnabled("phase1.sis", viewer.organizationId),
    isFeatureEnabled("phase2.academics", viewer.organizationId),
    isFeatureEnabled("ai.copilot", viewer.organizationId),
  ]);

  // Teacher daily view (blueprint 10.3): today's timetable and any section
  // still waiting for its register. Only for people with a Staff record.
  const ctx = viewer.organizationId ? await resolveBranchContext(viewer, undefined) : null;
  const staff = academicsEnabled && ctx ? await getStaffForViewer(viewer.userId, ctx.organizationId) : null;
  const today = new Date();
  const [slots, pending] = staff ? await Promise.all([todaysSlotsForStaff(staff.id, today), pendingSectionsForStaff(staff.id, today)]) : [[], []];

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Welcome, {viewer.name}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Phase 0 (tenancy, identity, RBAC, audit, feature flags), Phase 1 (students, guardians, staff, academic
          structure) and Phase 2 (subjects, teaching assignments, timetable, attendance) are live. Everything else in the
          nav is a placeholder for the phase that builds it.
        </p>
      </div>

      {staff && ctx ? (
        <Card title={`Today · ${DAY_LABELS[dayOfWeekFor(today)]} ${today.toISOString().slice(0, 10)}`}>
          {pending.length > 0 ? (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/30">
              <p className="font-medium text-amber-800 dark:text-amber-300">Attendance not yet taken</p>
              <ul className="mt-1 flex flex-wrap gap-2">
                {pending.map((p) => (
                  <li key={p.sectionId}>
                    <Link href={withBranch(`/academics/attendance?section=${p.sectionId}`, ctx)} className="text-sm text-amber-900 underline dark:text-amber-200">
                      {p.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : slots.length > 0 ? (
            <p className="mb-4 text-sm text-emerald-700 dark:text-emerald-300">All of today&apos;s registers are taken.</p>
          ) : null}

          {slots.length === 0 ? (
            <EmptyState>Nothing on your timetable today.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {slots.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <div>
                    <span className="font-mono text-xs text-zinc-500">
                      {s.startTime}–{s.endTime}
                    </span>{" "}
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">{s.subject.name}</span>{" "}
                    <span className="text-zinc-500 dark:text-zinc-400">
                      · {s.section.grade.name} / {s.section.name}
                      {s.room ? ` · ${s.room}` : ""}
                    </span>
                  </div>
                  <Link href={withBranch(`/academics/attendance?section=${s.sectionId}`, ctx)} className="text-xs text-zinc-600 underline dark:text-zinc-300">
                    Register
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs">
            <Link href={withBranch("/academics/timetable?view=me", ctx)} className="text-zinc-600 underline dark:text-zinc-300">
              Full week
            </Link>
          </p>
        </Card>
      ) : null}

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
          <FlagRow flagKey="phase2.academics" label="Academics (Phase 2)" enabled={academicsEnabled} />
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
      <Badge tone={enabled ? "green" : "neutral"}>{enabled ? "Enabled" : "Disabled"}</Badge>
    </li>
  );
}
