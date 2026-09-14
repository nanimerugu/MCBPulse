import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { Button, EmptyState, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadAcademicsAccess, param } from "@/modules/sis/access";
import { listEnrollableSections } from "@/modules/sis/students.service";
import { listAssignments, listTeachingStaff } from "@/modules/academics/assignments.service";
import { listSubjects } from "@/modules/academics/subjects.service";
import { listSlotsForSection, listSlotsForStaff } from "@/modules/academics/timetable.service";
import { getSectionScope, sectionInScope } from "@/modules/academics/scope";
import { DAYS, DAY_LABELS } from "@/modules/academics/timetable-conflicts";
import { createSlotAction, deleteSlotAction } from "@/app/(app)/academics/actions";
import { SlotForm } from "@/app/(app)/academics/timetable/slot-form";

type Slot = Awaited<ReturnType<typeof listSlotsForSection>>[number];

export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadAcademicsAccess(param(sp, "branch"), "academics.timetable", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Timetable" />
        <AccessDenied result={result} permission="academics.timetable:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const scope = await getSectionScope(result.access);
  const viewMine = param(sp, "view") === "me" && scope.staffId;

  const allSections = await listEnrollableSections(ctx.branch.id);
  const sections = allSections.filter((s) => sectionInScope(scope, s.id));
  const requested = param(sp, "section");
  const section = viewMine ? undefined : sections.find((s) => s.id === requested) ?? sections[0];

  const slots: Slot[] = viewMine
    ? await listSlotsForStaff(scope.staffId!)
    : section
      ? await listSlotsForSection(section.id, ctx.organizationId)
      : [];

  const canConfigure =
    !viewMine && section
      ? await authorize(viewer.userId, "academics.timetable", "configure", { organizationId: ctx.organizationId, branchId: ctx.branch.id })
      : false;

  const [assignments, subjects, staff] = canConfigure && section
    ? await Promise.all([listAssignments(section.id, ctx.organizationId), listSubjects(ctx.organizationId), listTeachingStaff(ctx.organizationId, ctx.branch.id)])
    : [[], [], []];
  const assignedBySubject = new Map(assignments.map((a) => [a.subjectId, a.staffId]));

  const byDay = new Map(DAYS.map((d) => [d, slots.filter((s) => s.dayOfWeek === d)]));
  const showDays = DAYS.filter((d) => d !== "SUNDAY" || (byDay.get(d)?.length ?? 0) > 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={viewMine ? "My timetable" : "Timetable"}
        description={viewMine ? `Every section you teach · ${ctx.academicYear?.name ?? ""}` : section ? `${section.grade.name} / ${section.name} · ${ctx.academicYear?.name ?? ""}` : undefined}
        actions={
          scope.staffId ? (
            <Link href={withBranch(viewMine ? "/academics/timetable" : "/academics/timetable?view=me", ctx)} className="text-sm text-zinc-600 underline dark:text-zinc-300">
              {viewMine ? "By section" : "My timetable"}
            </Link>
          ) : null
        }
      />

      {!viewMine && sections.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">Section:</span>
          {sections.map((s) => (
            <Link
              key={s.id}
              href={withBranch(`/academics/timetable?section=${s.id}`, ctx)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                s.id === section?.id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              {s.grade.name} / {s.name}
            </Link>
          ))}
        </div>
      ) : null}

      {!viewMine && !section ? (
        <EmptyState>{scope.sectionIds !== null ? "You aren't assigned to any section yet." : "No sections in the current academic year."}</EmptyState>
      ) : slots.length === 0 ? (
        <EmptyState>No slots yet.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {showDays.map((day) => (
            <div key={day} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
              <p className="border-b border-zinc-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">{DAY_LABELS[day]}</p>
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {(byDay.get(day) ?? []).map((s) => (
                  <li key={s.id} className="px-3 py-2 text-sm">
                    <p className="font-mono text-xs text-zinc-500">
                      {s.startTime}–{s.endTime}
                      {s.room ? ` · ${s.room}` : ""}
                    </p>
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">{s.subject.name}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{viewMine ? `${s.section.grade.name} / ${s.section.name}` : s.staff.user.name}</p>
                    {canConfigure ? (
                      <form action={deleteSlotAction} className="mt-1">
                        <input type="hidden" name="branchId" value={ctx.branch.id} />
                        <input type="hidden" name="slotId" value={s.id} />
                        <Button type="submit" variant="danger" className="!px-2 !py-0.5 text-xs">
                          Remove
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
                {(byDay.get(day) ?? []).length === 0 ? <li className="px-3 py-2 text-xs text-zinc-400">—</li> : null}
              </ul>
            </div>
          ))}
        </div>
      )}

      {canConfigure && section ? (
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Add a slot</h2>
          <SlotForm
            action={createSlotAction}
            branchId={ctx.branch.id}
            sectionId={section.id}
            subjects={subjects.map((s) => ({ id: s.id, label: `${s.name} (${s.code})`, assignedStaffId: assignedBySubject.get(s.id) ?? null }))}
            staff={staff.map((s) => ({ id: s.id, label: `${s.user.name} (${s.employeeCode})` }))}
          />
        </div>
      ) : null}
    </div>
  );
}
