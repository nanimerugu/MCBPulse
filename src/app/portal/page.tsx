import Link from "next/link";
import { Badge, Card, EmptyState } from "@/components/ui";
import { ChildSwitcher } from "@/components/portal/child-switcher";
import { PortalDenied } from "@/components/portal/denial";
import { loadPortalPage } from "@/modules/portal/page-shell";
import { getPortalScope } from "@/modules/portal/scope";
import { getAttendanceSummary, getClinicVisits, getDriverManifest, getFees, getPortalChild } from "@/modules/portal/portal.service";
import { formatRate } from "@/modules/academics/attendance-summary";
import { formatMoney } from "@/modules/finance/money";
import { formatDate } from "@/modules/sis/labels";
import { CLINIC_OUTCOME_LABELS } from "@/modules/operations/campus.service";
import { param } from "@/modules/sis/access";

export default async function PortalHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  // The driver's home is a manifest, not a child view — resolve the scope
  // first and branch before loading anything student-shaped.
  const scopeResult = await getPortalScope();
  if (!scopeResult.ok) return <PortalDenied result={scopeResult} />;

  if (scopeResult.scope.kind === "driver") {
    const manifest = await getDriverManifest(scopeResult.scope);
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Today&apos;s manifest</h1>
        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          {manifest.length} student{manifest.length === 1 ? "" : "s"} on your routes
        </p>
        <Card title="Students">
          {manifest.length === 0 ? (
            <EmptyState>Nobody is allocated to your routes.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {manifest.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {m.student.firstName} {m.student.lastName}
                    {m.student.currentSection ? (
                      <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                        {m.student.currentSection.grade.name}/{m.student.currentSection.name}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-right text-xs text-zinc-500 dark:text-zinc-400">
                    {m.stop.sequence}. {m.stop.name}
                    <br />
                    {m.route.name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-600">
          A driver sees names, sections and stops only — nothing academic, medical or financial.
        </p>
      </div>
    );
  }

  const page = await loadPortalPage(param(sp, "child"));
  if (!page.ok) return <PortalDenied result={page.result} />;
  const { scope, studentId, children } = page;

  const [child, attendance, fees, clinic] = await Promise.all([
    getPortalChild(studentId, scope.organizationId),
    getAttendanceSummary(studentId, scope.organizationId),
    scope.kind === "parent" ? getFees(studentId, scope.organizationId) : Promise.resolve(null),
    getClinicVisits(studentId, scope.organizationId),
  ]);
  if (!child) return <PortalDenied result={{ ok: false, reason: "nothing_linked", viewer: scope.viewer }} />;

  return (
    <div className="mx-auto max-w-2xl">
      <ChildSwitcher scope={scope} students={children} activeId={studentId} basePath="/portal" />

      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        {child.firstName} {child.lastName}
      </h1>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        {child.currentSection ? `${child.currentSection.grade.name} / ${child.currentSection.name} · ` : ""}
        {child.branch.name} · {child.admissionNumber}
      </p>

      <div className="flex flex-col gap-4">
        {attendance ? (
          <Card title="Attendance — last 30 days">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
              <p className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{formatRate(attendance.summary.attendedRate)}</p>
              <p className="text-zinc-500 dark:text-zinc-400">
                {attendance.summary.present} present · {attendance.summary.absent} absent · {attendance.summary.late} late ·{" "}
                {attendance.summary.excused} excused
              </p>
            </div>
            <Link href="/portal/attendance" className="mt-3 inline-block text-sm font-medium text-zinc-900 underline dark:text-zinc-50">
              See the days
            </Link>
          </Card>
        ) : null}

        {fees ? (
          <Card title="Fees">
            {fees.outstandingMinor === 0 ? (
              <p className="text-sm text-emerald-700 dark:text-emerald-400">Nothing outstanding.</p>
            ) : (
              <p className="text-sm">
                <span className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{formatMoney(fees.outstandingMinor)}</span>
                <span className="ml-2 text-zinc-500 dark:text-zinc-400">outstanding</span>
              </p>
            )}
            <Link href="/portal/fees" className="mt-3 inline-block text-sm font-medium text-zinc-900 underline dark:text-zinc-50">
              See invoices
            </Link>
          </Card>
        ) : null}

        {child.transportLink ? (
          <Card title="Transport">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              {child.transportLink.route.name} · stop {child.transportLink.stop.sequence}. {child.transportLink.stop.name}
              {child.transportLink.route.vehicle ? ` · ${child.transportLink.route.vehicle.registrationNumber}` : ""}
            </p>
          </Card>
        ) : null}

        {child.hostelAllocations.length > 0 ? (
          <Card title="Hostel">
            {child.hostelAllocations.map((a) => (
              <p key={a.id} className="text-sm text-zinc-700 dark:text-zinc-300">
                {a.hostelRoom.hostelBlock.name}, room {a.hostelRoom.roomNumber} · since {formatDate(a.allocatedFrom)}
              </p>
            ))}
          </Card>
        ) : null}

        {clinic && clinic.length > 0 ? (
          <Card title="Infirmary visits">
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {clinic.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {v.complaint}
                    <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">{formatDate(v.visitedAt)}</span>
                  </span>
                  <Badge tone={v.outcome === "RETURNED_TO_CLASS" ? "green" : v.outcome === "REFERRED_TO_HOSPITAL" ? "red" : "amber"}>
                    {CLINIC_OUTCOME_LABELS[v.outcome].toLowerCase()}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
