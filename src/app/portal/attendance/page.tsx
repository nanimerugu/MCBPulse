import { Badge, Card, EmptyState } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import { ChildSwitcher } from "@/components/portal/child-switcher";
import { PortalDenied } from "@/components/portal/denial";
import { loadPortalPage } from "@/modules/portal/page-shell";
import { getAttendanceSummary, getTimetable } from "@/modules/portal/portal.service";
import { ATTENDANCE_STATUS_LABELS, formatRate } from "@/modules/academics/attendance-summary";
import { formatDate } from "@/modules/sis/labels";
import { param } from "@/modules/sis/access";
import type { AttendanceStatus, DayOfWeek } from "@/generated/prisma/enums";

const TONES: Record<AttendanceStatus, BadgeTone> = { PRESENT: "green", ABSENT: "red", LATE: "amber", EXCUSED: "blue" };
const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

export default async function PortalAttendance({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const page = await loadPortalPage(param(sp, "child"));
  if (!page.ok) return <PortalDenied result={page.result} />;
  const { scope, studentId, children } = page;

  const [attendance, timetable] = await Promise.all([
    getAttendanceSummary(studentId, scope.organizationId),
    getTimetable(studentId, scope.organizationId),
  ]);

  const byDay = new Map<DayOfWeek, NonNullable<typeof timetable>>();
  for (const slot of timetable ?? []) {
    const list = byDay.get(slot.dayOfWeek) ?? [];
    list.push(slot);
    byDay.set(slot.dayOfWeek, list);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <ChildSwitcher scope={scope} students={children} activeId={studentId} basePath="/portal/attendance" />
      <h1 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Attendance & timetable</h1>

      <div className="flex flex-col gap-4">
        {attendance === null ? (
          <EmptyState>Attendance is not switched on at this school.</EmptyState>
        ) : (
          <>
            <Card title="Last 30 days">
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
                <p className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{formatRate(attendance.summary.attendedRate)}</p>
                <p className="text-zinc-500 dark:text-zinc-400">
                  {attendance.summary.present} present · {attendance.summary.absent} absent · {attendance.summary.late} late ·{" "}
                  {attendance.summary.excused} excused
                </p>
              </div>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                Late counts as attended; excused leaves the day out of the rate entirely.
              </p>
            </Card>

            <Card title="Recent days">
              {attendance.recent.length === 0 ? (
                <EmptyState>No attendance recorded in the last 30 days.</EmptyState>
              ) : (
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {attendance.recent.map((r) => (
                    <li key={r.date.toISOString()} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-zinc-700 dark:text-zinc-300">{formatDate(r.date)}</span>
                      <Badge tone={TONES[r.status]}>{ATTENDANCE_STATUS_LABELS[r.status].toLowerCase()}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}

        {timetable && timetable.length > 0 ? (
          <Card title="Weekly timetable">
            <div className="flex flex-col gap-3">
              {[...byDay.entries()].map(([day, slots]) => (
                <div key={day}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{DAY_LABELS[day]}</p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {slots.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-zinc-700 dark:text-zinc-300">{s.subject.name}</span>
                        <span className="text-right text-xs text-zinc-500 dark:text-zinc-400">
                          {s.startTime}–{s.endTime}
                          {s.room ? ` · ${s.room}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
