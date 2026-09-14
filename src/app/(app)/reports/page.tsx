import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { db } from "@/lib/db";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadReportingAccess, param } from "@/modules/sis/access";
import { listReportCards, listScales } from "@/modules/reporting/report-cards.service";
import { DEFAULT_BANDS, TERMS } from "@/modules/reporting/grading-scale";
import { describeWeights, weightsOf } from "@/modules/reporting/weighting";
import { getSectionScope, sectionInScope } from "@/modules/academics/scope";
import { formatDate } from "@/modules/sis/labels";
import { createScaleAction, generateReportCardAction, setDefaultScaleAction } from "@/app/(app)/reports/actions";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadReportingAccess(param(sp, "branch"), "reporting.cards", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Report cards" />
        <AccessDenied result={result} permission="reporting.cards:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const scope = { organizationId: ctx.organizationId, branchId: ctx.branch.id };

  const [cards, held, sectionScope, scales, years] = await Promise.all([
    listReportCards(scope),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
    getSectionScope(result.access),
    listScales(ctx.organizationId),
    db.academicYear.findMany({ where: { branchId: ctx.branch.id }, orderBy: { startDate: "desc" } }),
  ]);

  const students = await db.student.findMany({
    where: { organizationId: ctx.organizationId, branchId: ctx.branch.id, deletedAt: null, status: "ENROLLED" },
    include: { currentSection: { include: { grade: true } } },
    orderBy: { firstName: "asc" },
    take: 300,
  });

  // Teachers only see and report on the sections they teach.
  const visibleCards = cards.filter((c) => sectionInScope(sectionScope, c.student.currentSectionId ?? ""));
  const myStudents = students.filter((s) => sectionInScope(sectionScope, s.currentSectionId ?? ""));

  const hidden = { branchId: ctx.branch.id };
  const canConfigureScales = held.has("reporting.scales:configure");
  const defaultScale = scales.find((s) => s.isDefault) ?? scales[0];

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Report cards" description={`${visibleCards.length} report${visibleCards.length === 1 ? "" : "s"} · ${ctx.branch.name}`} />

      <Card title="Grading scales">
        {scales.length === 0 ? (
          <EmptyState>No scale configured — the CBSE-style default is created the first time a report is generated.</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {scales.map((s) => (
              <li key={s.id} className="py-3 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {s.name} {s.isDefault ? <Badge tone="green">default — used for new reports</Badge> : null}
                  </p>
                  {canConfigureScales && !s.isDefault ? (
                    <ActionForm action={setDefaultScaleAction.bind(null, s.id)} hidden={hidden} submitLabel="Make default" inline />
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {describeWeights(weightsOf(s))} · used by {s._count.reportCards} report{s._count.reportCards === 1 ? "" : "s"}
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {s.bands.map((b) => (
                    <li key={b.id} className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      <strong>{b.label}</strong> {b.minPercent}%+{b.description ? ` · ${b.description}` : ""}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          The scale is data, not code: a CBSE school, an IB school and a state-board school disagree about what 72% is called, and none of them
          are wrong. So is the weighting — leave it blank and exam and coursework marks are added together; set it (&quot;exams 80, coursework
          20&quot;) and each becomes a percentage first. Every report keeps a copy of the weighting it was made with.
        </p>

        {canConfigureScales ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-200">New grading scale</summary>
            <div className="mt-3">
              <ActionForm action={createScaleAction} hidden={hidden} submitLabel="Create scale">
                <Field label="Name" htmlFor="gs-name">
                  <Input id="gs-name" name="name" required maxLength={60} placeholder="CBSE with 80/20 weighting" />
                </Field>
                <Field label="Bands — one per line: label, lowest %, description" htmlFor="gs-bands" hint="The lowest band must start at 0.">
                  <Textarea
                    id="gs-bands"
                    name="bands"
                    rows={8}
                    required
                    className="font-mono"
                    defaultValue={DEFAULT_BANDS.map((b) => [b.label, b.minPercent, b.description].filter((x) => x !== null && x !== undefined).join(", ")).join("\n")}
                  />
                </Field>
                <div className="flex flex-wrap gap-3">
                  <Field label="Exam weight %" htmlFor="gs-ew" hint="Leave both blank to add marks together">
                    <Input id="gs-ew" name="examWeight" type="number" min={0} max={100} className="!w-32" />
                  </Field>
                  <Field label="Coursework weight %" htmlFor="gs-cw">
                    <Input id="gs-cw" name="courseworkWeight" type="number" min={0} max={100} className="!w-32" />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                  <input type="checkbox" name="isDefault" /> Use it for new reports
                </label>
              </ActionForm>
            </div>
          </details>
        ) : null}
      </Card>

      {held.has("reporting.cards:create") && myStudents.length > 0 && years.length > 0 ? (
        <Card title="Generate">
          <ActionForm action={generateReportCardAction} hidden={hidden} submitLabel="Generate" pendingLabel="Gathering marks…">
            <div className="flex flex-wrap gap-3">
              <Field label="Student" htmlFor="rc-student">
                <Select id="rc-student" name="studentId" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {myStudents.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.firstName} {s.lastName}
                      {s.currentSection ? ` (${s.currentSection.grade.name}/${s.currentSection.name})` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Year" htmlFor="rc-year">
                <Select id="rc-year" name="academicYearId" required defaultValue={years[0]?.id}>
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Term" htmlFor="rc-term">
                <Select id="rc-term" name="term" defaultValue={TERMS[0]}>
                  {TERMS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Remarks" htmlFor="rc-remarks" hint="Leave blank when regenerating to keep the remarks already written.">
              <Textarea id="rc-remarks" name="remarks" rows={2} maxLength={1000} placeholder="A steady term. Keep working on written explanations." />
            </Field>
          </ActionForm>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Uses {defaultScale ? <strong>{defaultScale.name}</strong> : "the default scale"}. A report is a snapshot: every figure is copied at
            generation, so a gradebook corrected next month never changes a report a family already has. Regenerating a draft replaces its
            figures but keeps subject comments; a published report can&apos;t be regenerated at all.
          </p>
        </Card>
      ) : null}

      <Card title="Reports">
        {visibleCards.length === 0 ? (
          <EmptyState>No report cards yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {visibleCards.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                <div>
                  <Link href={withBranch(`/reports/${c.id}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                    {c.student.firstName} {c.student.lastName}
                  </Link>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {c.term} · {c.academicYear.name}
                    {c.student.currentSection ? ` · ${c.student.currentSection.grade.name}/${c.student.currentSection.name}` : ""} ·{" "}
                    {formatDate(c.generatedAt)}
                  </p>
                </div>
                <span className="flex items-center gap-2">
                  {c.overallPercent !== null ? (
                    <span className="tabular-nums text-zinc-900 dark:text-zinc-50">
                      {c.overallPercent}%{c.overallBand ? ` · ${c.overallBand}` : ""}
                    </span>
                  ) : null}
                  <Badge tone={c.status === "PUBLISHED" ? "green" : "amber"}>{c.status.toLowerCase()}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
