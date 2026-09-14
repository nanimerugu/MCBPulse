import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { heldPermissionKeys } from "@/lib/rbac";
import { localDateISO } from "@/lib/time-zone";
import { Badge, Button, Card, EmptyState, Input, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadAcademicsAccess, param } from "@/modules/sis/access";
import { BLOCKER_LABELS, dayOfWeekForISODate } from "@/modules/academics/substitution";
import { DAY_LABELS } from "@/modules/academics/timetable-conflicts";
import { lessonsOn, suggestSubstitutes } from "@/modules/academics/substitutions.service";
import { branchTimeZone } from "@/modules/connect/quiet-hours";
import { assignCoverAction, cancelCoverAction } from "@/app/(app)/academics/substitutions/actions";

export default async function SubstitutionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadAcademicsAccess(param(sp, "branch"), "academics.substitutions", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Cover" />
        <AccessDenied result={result} permission="academics.substitutions:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const scope = { organizationId: ctx.organizationId, branchId: ctx.branch.id };

  const tz = await branchTimeZone(ctx.branch.id);
  const todayISO = localDateISO(new Date(), tz);
  const dateParam = param(sp, "date");
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayISO;
  const past = date < todayISO;

  const [lessons, held] = await Promise.all([lessonsOn(scope, date), heldPermissionKeys(viewer.userId, ctx.organizationId)]);
  const canConfigure = held.has("academics.substitutions:configure") && !past;

  const selectedSlotId = param(sp, "slot");
  const suggestion = selectedSlotId && lessons.some((l) => l.slot.id === selectedSlotId) ? await suggestSubstitutes(selectedSlotId, date, scope) : null;

  const needsCover = lessons.filter((l) => l.state === "needs_cover");
  const covered = lessons.filter((l) => l.state === "covered");
  const hidden = { branchId: ctx.branch.id };
  const link = (slotId: string) => withBranch(`/academics/substitutions?date=${date}&slot=${slotId}`, ctx);

  const lessonLine = (l: (typeof lessons)[number]) => (
    <>
      <span className="tabular-nums">
        {l.slot.startTime}–{l.slot.endTime}
      </span>{" "}
      · {l.slot.section.grade.name} / {l.slot.section.name} · {l.slot.subject.name} · <span className="text-zinc-500 dark:text-zinc-400">{l.slot.staff.user.name}</span>
    </>
  );

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader title="Cover" description={`${DAY_LABELS[dayOfWeekForISODate(date)]} ${date} · ${ctx.branch.name}`} />

      <form method="get" action="/academics/substitutions" className="flex items-end gap-2">
        {ctx.branches.length > 1 ? <input type="hidden" name="branch" value={ctx.branch.id} /> : null}
        <Input type="date" name="date" defaultValue={date} aria-label="Date" className="w-40" />
        <Button type="submit" variant="secondary">
          Go
        </Button>
      </form>

      <Card title={`Needs cover (${needsCover.length})`}>
        {needsCover.length === 0 ? (
          <EmptyState>No lesson that day belongs to a teacher on approved leave without cover.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {needsCover.map((l) => (
              <li key={l.slot.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {lessonLine(l)} <Badge tone="red">teacher on leave</Badge>
                </span>
                <Link href={link(l.slot.id)} className="text-sm font-medium text-zinc-900 underline dark:text-zinc-50">
                  {canConfigure ? "Arrange cover" : "See who's free"}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Built from approved staff leave. A teacher who phoned in sick this morning hasn&apos;t filed leave — pick their lesson from the full
          list below and arrange cover the same way.
        </p>
      </Card>

      {suggestion ? (
        <Card title={`Cover for ${suggestion.slot.section.grade.name} / ${suggestion.slot.section.name} ${suggestion.slot.subject.name}, ${suggestion.slot.startTime}–${suggestion.slot.endTime}`}>
          {suggestion.cover ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm dark:border-green-800 dark:bg-green-950">
              <span>
                Covered by <strong>{suggestion.cover.substituteStaff.user.name}</strong>
                {suggestion.cover.reason ? ` — ${suggestion.cover.reason}` : ""}
              </span>
              {canConfigure ? <ActionForm action={cancelCoverAction.bind(null, suggestion.cover.id)} hidden={hidden} submitLabel="Cancel cover" variant="danger" inline /> : null}
            </div>
          ) : null}
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {suggestion.ranked.map((c) => {
              const isCurrent = suggestion.cover?.substituteStaffId === c.staffId;
              return (
                <li key={c.staffId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <span className={c.available ? "font-medium text-zinc-900 dark:text-zinc-50" : "text-zinc-400 dark:text-zinc-500"}>{c.name}</span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {" "}
                      · {c.available ? [...c.strengths, `${c.load} lesson${c.load === 1 ? "" : "s"} that day`].join(" · ") : c.blockers.map((b) => BLOCKER_LABELS[b]).join(", ")}
                    </span>
                  </span>
                  {canConfigure && c.available && !isCurrent ? (
                    <ActionForm action={assignCoverAction.bind(null, { slotId: suggestion.slot.id, dateISO: date, staffId: c.staffId })} hidden={hidden} submitLabel="Assign" inline>
                      <Input name="reason" maxLength={200} placeholder="reason (optional)" aria-label={`Reason for ${c.name} covering`} className="!w-44" />
                    </ActionForm>
                  ) : isCurrent ? (
                    <Badge tone="green">covering</Badge>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Free people first; among them a subject specialist, then someone who teaches the class, then whoever has the lightest day. Availability
            is checked again when you press Assign, in case someone else has just given them another lesson.
          </p>
        </Card>
      ) : null}

      {covered.length > 0 ? (
        <Card title={`Covered (${covered.length})`}>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {covered.map((l) => (
              <li key={l.slot.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {lessonLine(l)} → <strong>{l.cover?.substituteStaff.user.name}</strong>
                </span>
                <Link href={link(l.slot.id)} className="text-xs underline">
                  details
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title={`All lessons that day (${lessons.length})`}>
        {lessons.length === 0 ? (
          <EmptyState>Nothing on the timetable for that day.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {lessons.map((l) => (
              <li key={l.slot.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                <span>{lessonLine(l)}</span>
                <Link href={link(l.slot.id)} className="text-xs underline">
                  {l.cover ? `covered by ${l.cover.substituteStaff.user.name}` : canConfigure ? "arrange cover" : "who's free"}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
