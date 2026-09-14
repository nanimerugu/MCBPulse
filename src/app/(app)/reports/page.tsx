import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { db } from "@/lib/db";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadReportingAccess, param } from "@/modules/sis/access";
import { listReportCards, listScales } from "@/modules/reporting/report-cards.service";
import { TERMS } from "@/modules/reporting/grading-scale";
import { getSectionScope, sectionInScope } from "@/modules/academics/scope";
import { formatDate } from "@/modules/sis/labels";
import { generateReportCardAction } from "@/app/(app)/reports/actions";

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
  const scale = scales.find((s) => s.isDefault) ?? scales[0];

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Report cards" description={`${visibleCards.length} report${visibleCards.length === 1 ? "" : "s"} · ${ctx.branch.name}`} />

      <Card title="Grading scale">
        {!scale ? (
          <EmptyState>No scale configured — the CBSE-style default is created the first time a report is generated.</EmptyState>
        ) : (
          <>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {scale.name} {scale.isDefault ? <Badge tone="green">default</Badge> : null}
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {scale.bands.map((b) => (
                <li key={b.id} className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  <strong>{b.label}</strong> {b.minPercent}%+{b.description ? ` · ${b.description}` : ""}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          The scale is data, not code: a CBSE school, an IB school and a state-board school disagree about what 72% is called, and none of
          them are wrong. Exam and assignment marks are <strong>summed</strong>, not weighted — a weighting is school policy, and inventing
          one would put a number on a report card that no teacher chose.
        </p>
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
            <Field label="Remarks" htmlFor="rc-remarks">
              <Textarea id="rc-remarks" name="remarks" rows={2} maxLength={1000} placeholder="A steady term. Keep working on written explanations." />
            </Field>
          </ActionForm>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            A report is a snapshot: every figure is copied at generation, so a gradebook corrected next month never changes a report a
            family already has. Regenerating replaces a draft; a published report can&apos;t be regenerated at all.
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
