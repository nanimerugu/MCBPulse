import { notFound } from "next/navigation";
import { withBranch } from "@/lib/branch-context";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, LinkButton, PageHeader, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadReportingAccess, param } from "@/modules/sis/access";
import { getSectionScope, sectionInScope } from "@/modules/academics/scope";
import { getReportCard } from "@/modules/reporting/report-cards.service";
import { describeWeights, weightsOf } from "@/modules/reporting/weighting";
import { formatDate } from "@/modules/sis/labels";
import { publishReportCardAction, saveCommentsAction } from "@/app/(app)/reports/actions";

export default async function ReportCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ reportCardId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ reportCardId }, sp] = await Promise.all([params, searchParams]);
  const result = await loadReportingAccess(param(sp, "branch"), "reporting.cards", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Report card" />
        <AccessDenied result={result} permission="reporting.cards:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const [card, held, sectionScope] = await Promise.all([
    getReportCard(reportCardId, { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
    getSectionScope(result.access),
  ]);
  if (!card) notFound();

  // The list already hid other sections' reports from a teacher; the page
  // must not show one to a teacher who typed its URL.
  if (!sectionInScope(sectionScope, card.student.currentSectionId ?? "")) {
    return (
      <>
        <PageHeader title="Report card" />
        <EmptyState>This student isn&apos;t in one of your assigned sections.</EmptyState>
      </>
    );
  }

  const hidden = { branchId: ctx.branch.id };
  const weights = weightsOf(card);
  const canComment = card.status === "DRAFT" && held.has("reporting.cards:create");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {/* print:hidden keeps the chrome off a printed report. */}
      <div className="print:hidden">
        <PageHeader
          title="Report card"
          description={`${card.student.firstName} ${card.student.lastName} · ${card.term} · ${card.academicYear.name}`}
          actions={<LinkButton href={withBranch("/reports", ctx)}>All reports</LinkButton>}
        />
        {card.status === "DRAFT" && held.has("reporting.cards:publish") ? (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
            <p className="mb-2 text-amber-900 dark:text-amber-200">
              This is a draft. Publishing shows it to the family in the portal and freezes it — figures and comments alike.
            </p>
            <ActionForm action={publishReportCardAction.bind(null, reportCardId)} hidden={hidden} submitLabel="Publish to the family" variant="primary" inline />
          </div>
        ) : null}
      </div>

      {/* The report itself, laid out to print on one page. */}
      <article className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800 print:border-0 print:p-0">
        <header className="border-b border-zinc-200 pb-4 dark:border-zinc-800">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{card.student.branch.name}</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            {card.term} report · {card.academicYear.name}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Student</dt>
              <dd className="text-zinc-900 dark:text-zinc-50">
                {card.student.firstName} {card.student.lastName}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Class</dt>
              <dd className="text-zinc-900 dark:text-zinc-50">
                {card.student.currentSection ? `${card.student.currentSection.grade.name} / ${card.student.currentSection.name}` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Admission no.</dt>
              <dd className="text-zinc-900 dark:text-zinc-50">{card.student.admissionNumber}</dd>
            </div>
          </dl>
        </header>

        {card.lines.length === 0 ? (
          <EmptyState>No subjects on this report.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="mt-4 w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <tr>
                  <th className="py-2 pr-4 font-medium">Subject</th>
                  <th className="py-2 pr-4 text-right font-medium">Exams{weights ? ` (${weights.exam}%)` : ""}</th>
                  <th className="py-2 pr-4 text-right font-medium">Coursework{weights ? ` (${weights.coursework}%)` : ""}</th>
                  <th className="py-2 pr-4 text-right font-medium">%</th>
                  <th className="py-2 text-right font-medium">Grade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {card.lines.map((l) => (
                  <tr key={l.id} className="align-top">
                    <td className="py-2 pr-4 text-zinc-900 dark:text-zinc-50">
                      {l.subjectName}
                      {l.basisNote ? <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">{l.basisNote}</p> : null}
                      {l.comment ? <p className="mt-1 text-xs italic text-zinc-600 dark:text-zinc-300">“{l.comment}”</p> : null}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                      {l.examMax ? `${l.examMarks ?? 0}/${l.examMax}` : "—"}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                      {l.assignmentMax ? `${l.assignmentMarks ?? 0}/${l.assignmentMax}` : "—"}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-zinc-900 dark:text-zinc-50">{l.percent ?? "—"}</td>
                    <td className="py-2 text-right font-medium text-zinc-900 dark:text-zinc-50">{l.band ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-zinc-300 dark:border-zinc-700">
                <tr>
                  <td className="py-2 pr-4 font-medium text-zinc-900 dark:text-zinc-50">Overall</td>
                  <td colSpan={2} />
                  <td className="py-2 pr-4 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{card.overallPercent ?? "—"}</td>
                  <td className="py-2 text-right font-semibold text-zinc-900 dark:text-zinc-50">{card.overallBand ?? "—"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Attendance</p>
            <p className="text-zinc-900 dark:text-zinc-50">{card.attendancePercent !== null ? `${card.attendancePercent}%` : "—"}</p>
          </div>
          {card.gradingScale ? (
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Grading scale</p>
              <p className="text-zinc-900 dark:text-zinc-50">{card.gradingScale.name}</p>
            </div>
          ) : null}
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Weighting</p>
            <p className="text-zinc-900 dark:text-zinc-50">{describeWeights(weights)}</p>
          </div>
        </div>

        {card.remarks ? (
          <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Remarks</p>
            <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-200">{card.remarks}</p>
          </div>
        ) : null}

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <span>
            Generated {formatDate(card.generatedAt)}
            {card.publishedAt ? ` · published ${formatDate(card.publishedAt)}` : ""}
          </span>
          <span className="print:hidden">
            <Badge tone={card.status === "PUBLISHED" ? "green" : "amber"}>{card.status.toLowerCase()}</Badge>
          </span>
        </footer>
      </article>

      {canComment ? (
        <div className="print:hidden">
          <Card title="Comments">
            <ActionForm action={saveCommentsAction.bind(null, reportCardId)} hidden={hidden} submitLabel="Save comments" pendingLabel="Saving…">
              {card.lines.map((l) => (
                <Field key={l.id} label={l.subjectName} htmlFor={`c-${l.id}`}>
                  <Textarea id={`c-${l.id}`} name={`comment:${l.id}`} rows={2} maxLength={500} defaultValue={l.comment ?? ""} />
                </Field>
              ))}
              <Field label="Overall remarks" htmlFor="c-remarks">
                <Textarea id="c-remarks" name="remarks" rows={2} maxLength={1000} defaultValue={card.remarks ?? ""} />
              </Field>
            </ActionForm>
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              Comments survive regenerating the draft (after a corrected mark, say) and are frozen when it is published.
            </p>
          </Card>
        </div>
      ) : null}

      <Card title="About these figures">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-zinc-600 dark:text-zinc-300 print:hidden">
          <li>Every number is a snapshot copied when the report was generated, not a live read of the gradebook.</li>
          <li>
            {weights
              ? `Each subject blends its exam and coursework percentages ${weights.exam}/${weights.coursework}; the overall figure counts every subject equally.`
              : "Exam and coursework marks are added together; the overall figure counts every mark once."}
          </li>
          <li>Where only one kind of mark exists, the subject line says so rather than treating the missing work as zero.</li>
          <li>A subject with no marks shows a dash rather than 0%, which would read as a fail.</li>
        </ul>
      </Card>
    </div>
  );
}
