import { heldPermissionKeys } from "@/lib/rbac";
import { withBranch } from "@/lib/branch-context";
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadSisAccess, param } from "@/modules/sis/access";
import { DECISIONS, DECISION_LABELS, summarizePlan } from "@/modules/sis/promotion";
import { getPromotionPlan, listYears } from "@/modules/sis/year-end.service";
import { commitYearEndAction, copySectionsAction, createNextYearAction } from "@/app/(app)/settings/year-end/actions";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function YearEndPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadSisAccess(param(sp, "branch"), "tenant.academic_years", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Year end" />
        <AccessDenied result={result} permission="tenant.academic_years:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const scope = { organizationId: ctx.organizationId, branchId: ctx.branch.id };
  const [years, plan, held] = await Promise.all([listYears(scope), getPromotionPlan(scope), heldPermissionKeys(viewer.userId, ctx.organizationId)]);
  const canCreate = held.has("tenant.academic_years:create");
  const canCommit = held.has("tenant.academic_years:edit") && held.has("sis.enrollment:edit");
  const hidden = { branchId: ctx.branch.id };

  // Suggested dates for next year: the day after this one ends, for a year.
  const suggestStart = plan.current ? new Date(plan.current.endDate.getTime() + 86_400_000) : null;
  const suggestEnd = suggestStart ? new Date(Date.UTC(suggestStart.getUTCFullYear() + 1, suggestStart.getUTCMonth(), suggestStart.getUTCDate() - 1)) : null;
  const suggestName = suggestStart ? `${suggestStart.getUTCFullYear()}-${suggestStart.getUTCFullYear() + 1}` : "";
  const counts = summarizePlan(plan.rows);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Year end"
        description={`${ctx.branch.name} · open next year, decide every student's move, then switch years in one step`}
        actions={<LinkButton href={withBranch("/settings", ctx)}>← Settings</LinkButton>}
      />

      <Card title="Academic years">
        {years.length === 0 ? (
          <EmptyState>No academic years.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {years.map((y) => (
              <li key={y.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <strong>{y.name}</strong>{" "}
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {iso(y.startDate)} → {iso(y.endDate)} · {y._count.sections} section{y._count.sections === 1 ? "" : "s"}
                    {y._count.studentOutcomes > 0 ? ` · ${y._count.studentOutcomes} year-end outcomes recorded` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={y.isCurrent ? "green" : y.isClosed ? "neutral" : "blue"}>{y.isCurrent ? "current" : y.isClosed ? "closed" : "upcoming"}</Badge>
                  {!y.isCurrent && !y.isClosed && y._count.sections === 0 && canCreate && plan.current ? (
                    <ActionForm action={copySectionsAction.bind(null, y.id)} hidden={hidden} submitLabel={`Copy ${plan.current.name}'s sections`} inline />
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!plan.current ? (
        <EmptyState>This branch has no open current year, so there is nothing to close.</EmptyState>
      ) : !plan.next ? (
        <Card title="Step 1 · Open next year">
          {canCreate ? (
            <ActionForm action={createNextYearAction} hidden={hidden} submitLabel="Create next year" variant="primary">
              <div className="flex flex-wrap gap-3">
                <Field label="Name" htmlFor="ny-name">
                  <Input id="ny-name" name="name" required maxLength={40} defaultValue={suggestName} className="!w-40" />
                </Field>
                <Field label="Starts" htmlFor="ny-start">
                  <Input id="ny-start" name="start" type="date" required defaultValue={suggestStart ? iso(suggestStart) : ""} className="!w-44" />
                </Field>
                <Field label="Ends" htmlFor="ny-end">
                  <Input id="ny-end" name="end" type="date" required defaultValue={suggestEnd ? iso(suggestEnd) : ""} className="!w-44" />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                <input type="checkbox" name="copySections" defaultChecked /> Copy {plan.current.name}&apos;s sections (same grades, names and capacities)
              </label>
            </ActionForm>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Opening a new year needs tenant.academic_years:create.</p>
          )}
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Creating the year changes nothing else: {plan.current.name} stays current, and nobody moves, until step 2 is committed.
          </p>
        </Card>
      ) : (
        <Card title={`Step 2 · ${plan.current.name} → ${plan.next.name}`}>
          <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
            {plan.rows.length} enrolled student{plan.rows.length === 1 ? "" : "s"} · suggested: {counts.PROMOTE} promote, {counts.RETAIN} keep back, {counts.GRADUATE} graduate,{" "}
            {counts.UNPLACED} unplaced. Change any row; everything is checked together when you commit.
          </p>
          {plan.nextSections.length === 0 ? (
            <p role="alert" className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {plan.next.name} has no sections, so nobody can be placed. Copy this year&apos;s sections into it above.
            </p>
          ) : null}

          <ActionForm action={commitYearEndAction} hidden={hidden} submitLabel={`Close ${plan.current.name} and open ${plan.next.name}`} pendingLabel="Committing the year-end…" variant="danger">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Student</th>
                    <th className="py-2 pr-3 font-medium">This year</th>
                    <th className="py-2 pr-3 font-medium">Decision</th>
                    <th className="py-2 font-medium">Next year&apos;s section</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {plan.rows.map((r) => (
                    <tr key={r.student.studentId} className="align-top">
                      <td className="py-2 pr-3">
                        {r.student.name} <span className="font-mono text-xs text-zinc-500">{r.student.admissionNumber}</span>
                        {r.note ? <p className="text-xs text-amber-700 dark:text-amber-400">{r.note}</p> : null}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-zinc-600 dark:text-zinc-300">
                        {r.student.gradeName} / {r.student.sectionName}
                      </td>
                      <td className="py-2 pr-3">
                        <Select name={`decision:${r.student.studentId}`} defaultValue={r.decision} disabled={!canCommit} aria-label={`Decision for ${r.student.name}`} className="!w-52">
                          {DECISIONS.map((d) => (
                            <option key={d} value={d}>
                              {DECISION_LABELS[d]}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="py-2">
                        <Select name={`target:${r.student.studentId}`} defaultValue={r.targetSectionId ?? ""} disabled={!canCommit} aria-label={`Next year's section for ${r.student.name}`} className="!w-44">
                          <option value="">—</option>
                          {plan.nextSections.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.gradeName} / {s.name}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-md border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              <p className="font-medium text-zinc-900 dark:text-zinc-100">What committing does — all at once, or not at all</p>
              <ul className="mt-1 list-disc pl-5 text-zinc-600 dark:text-zinc-400">
                <li>
                  Closes {plan.current.name} and makes {plan.next.name} current, for attendance, timetables, cover, LMS and invoicing.
                </li>
                <li>Moves every student as decided above, graduates the leavers to alumni, and records each outcome on their profile.</li>
                <li>
                  Does <strong>not</strong> carry over timetables or teaching assignments — they belong to this year&apos;s sections. Set them up for{" "}
                  {plan.next.name} straight after, or teachers will see no classes.
                </li>
              </ul>
            </div>

            {canCommit ? (
              <Field label={`Type ${plan.next.name} to confirm`} htmlFor="ye-confirm">
                <Input id="ye-confirm" name="confirm" required autoComplete="off" className="!w-44" />
              </Field>
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Committing needs tenant.academic_years:edit and sis.enrollment:edit.</p>
            )}
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
