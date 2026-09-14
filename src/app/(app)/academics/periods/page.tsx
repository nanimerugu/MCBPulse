import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { authorize, resolveAccess } from "@/lib/rbac";
import { localDateISO } from "@/lib/time-zone";
import { Badge, Button, Card, EmptyState, Input, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadAcademicsAccess, param } from "@/modules/sis/access";
import { listEnrollableSections } from "@/modules/sis/students.service";
import { getStaffForViewer } from "@/modules/academics/scope";
import { dayOfWeekForISODate, isLessonTeacher, registerWindow } from "@/modules/academics/substitution";
import { DAY_LABELS } from "@/modules/academics/timetable-conflicts";
import { getPeriodRegister, lessonsForSection, lessonsForTeacher } from "@/modules/academics/period-attendance.service";
import { branchTimeZone } from "@/modules/connect/quiet-hours";
import { savePeriodRegisterAction } from "@/app/(app)/academics/periods/actions";
import { PeriodRegisterForm } from "@/app/(app)/academics/periods/period-register-form";

export default async function PeriodRegistersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadAcademicsAccess(param(sp, "branch"), "academics.attendance", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Lesson registers" />
        <AccessDenied result={result} permission="academics.attendance:view" />
      </>
    );
  }
  const { viewer, ctx, decision } = result.access;
  const tenant = { organizationId: ctx.organizationId, branchId: ctx.branch.id };

  const tz = await branchTimeZone(ctx.branch.id);
  const todayISO = localDateISO(new Date(), tz);
  const dateParam = param(sp, "date");
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayISO;

  const [staff, createDecision, canApprove] = await Promise.all([
    getStaffForViewer(viewer.userId, ctx.organizationId),
    resolveAccess(viewer.userId, "academics.attendance", "create", tenant),
    authorize(viewer.userId, "academics.attendance", "approve", tenant),
  ]);

  // A teacher sees their own day (lessons + cover). A school-wide viewer
  // picks a section and sees all of its lessons.
  const teacherView = decision.sectionScoped;
  const sections = teacherView ? [] : await listEnrollableSections(ctx.branch.id);
  const section = teacherView ? null : (sections.find((s) => s.id === param(sp, "section")) ?? sections[0] ?? null);

  const lessons = teacherView
    ? staff
      ? await lessonsForTeacher(staff.id, tenant, date)
      : []
    : section
      ? await lessonsForSection(section.id, tenant, date)
      : [];

  const selectedSlotId = param(sp, "slot") ?? lessons.find((l) => l.role !== "covered_by_other")?.slot.id;
  const register = selectedSlotId ? await getPeriodRegister(selectedSlotId, date, tenant) : null;

  let editable = false;
  let readOnlyReason: string | null = null;
  if (register) {
    const mine = isLessonTeacher({ viewerStaffId: staff?.id ?? null, slotStaffId: register.slot.staffId, coverStaffId: register.cover?.substituteStaffId ?? null });
    const window = registerWindow({ lessonDateISO: date, todayISO, canApprove });
    if (!createDecision.allowed) readOnlyReason = "You can view lesson registers but not take them.";
    else if (createDecision.sectionScoped && !mine)
      readOnlyReason = register.cover ? `${register.cover.substituteStaff.user.name} is covering this lesson, so the register is theirs.` : "Only this lesson's teacher can take its register.";
    else if (!window.ok) readOnlyReason = window.message;
    else editable = true;
  }

  const href = (extra: Record<string, string>) => {
    const qs = new URLSearchParams({ date, ...(section ? { section: section.id } : {}), ...extra });
    return withBranch(`/academics/periods?${qs.toString()}`, ctx);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Lesson registers"
        description={`${DAY_LABELS[dayOfWeekForISODate(date)]} ${date}${teacherView ? " · your lessons and cover" : section ? ` · ${section.grade.name} / ${section.name}` : ""}`}
      />

      <div className="flex flex-wrap items-end gap-4">
        {!teacherView && sections.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-zinc-500 dark:text-zinc-400">Section:</span>
            {sections.map((s) => (
              <Link
                key={s.id}
                href={withBranch(`/academics/periods?section=${s.id}&date=${date}`, ctx)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  s.id === section?.id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
              >
                {s.grade.name} / {s.name}
              </Link>
            ))}
          </div>
        ) : null}
        <form method="get" action="/academics/periods" className="flex items-end gap-2">
          {ctx.branches.length > 1 ? <input type="hidden" name="branch" value={ctx.branch.id} /> : null}
          {section ? <input type="hidden" name="section" value={section.id} /> : null}
          <Input type="date" name="date" defaultValue={date} aria-label="Date" className="w-40" />
          <Button type="submit" variant="secondary">
            Go
          </Button>
        </form>
      </div>

      <Card title={`Lessons (${lessons.length})`}>
        {lessons.length === 0 ? (
          <EmptyState>{teacherView && !staff ? "Your login has no staff record, so there is no timetable to show." : "No lessons on the timetable that day."}</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {lessons.map((l) => (
              <li key={`${l.slot.id}-${l.role}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <Link href={href({ slot: l.slot.id })} className={`hover:underline ${l.slot.id === selectedSlotId ? "font-semibold" : ""}`}>
                  <span className="tabular-nums">
                    {l.slot.startTime}–{l.slot.endTime}
                  </span>{" "}
                  · {l.slot.section.grade.name} / {l.slot.section.name} · {l.slot.subject.name}
                  {!teacherView || l.role === "covering" ? <span className="text-zinc-500 dark:text-zinc-400"> · {l.slot.staff.user.name}</span> : null}
                </Link>
                <span className="flex flex-wrap items-center gap-1.5">
                  {l.role === "covering" ? <Badge tone="blue">you are covering</Badge> : null}
                  {l.role === "covered_by_other" ? <Badge tone="neutral">covered by {l.coverName}</Badge> : null}
                  <Badge tone={l.register ? "green" : "amber"}>{l.register ? "register taken" : "not taken"}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {register ? (
        <Card title={`${register.slot.section.grade.name} / ${register.slot.section.name} · ${register.slot.subject.name} · ${register.slot.startTime}–${register.slot.endTime}`}>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            Timetabled teacher: {register.slot.staff.user.name}
            {register.cover ? ` · covered today by ${register.cover.substituteStaff.user.name}` : ""}
            {register.register ? ` · last saved by ${register.register.takenByStaff?.user.name ?? "an administrator"}` : ""}
          </p>
          {register.rows.length === 0 ? (
            <EmptyState>No enrolled students in this section.</EmptyState>
          ) : (
            <PeriodRegisterForm
              action={savePeriodRegisterAction}
              branchId={ctx.branch.id}
              slotId={register.slot.id}
              date={date}
              rows={register.rows}
              editable={editable}
              readOnlyReason={readOnlyReason}
            />
          )}
        </Card>
      ) : null}
    </div>
  );
}
