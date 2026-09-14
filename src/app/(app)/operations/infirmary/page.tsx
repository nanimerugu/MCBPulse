import { withBranch } from "@/lib/branch-context";
import { db } from "@/lib/db";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadOpsAccess, param } from "@/modules/sis/access";
import { CLINIC_OUTCOMES, CLINIC_OUTCOME_LABELS, listClinicVisits } from "@/modules/operations/campus.service";
import { hasDeliveringProvider } from "@/modules/connect/providers";
import { formatDate } from "@/modules/sis/labels";
import { recordClinicVisitAction } from "@/app/(app)/operations/actions";
import type { ClinicOutcome } from "@/generated/prisma/enums";

const OUTCOME_TONES: Record<ClinicOutcome, BadgeTone> = {
  RETURNED_TO_CLASS: "green",
  OBSERVATION: "amber",
  SENT_HOME: "amber",
  REFERRED_TO_HOSPITAL: "red",
};

export default async function InfirmaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadOpsAccess(param(sp, "branch"), "ops.infirmary", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Infirmary" />
        <AccessDenied result={result} permission="ops.infirmary:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;

  const [visits, held, students] = await Promise.all([
    listClinicVisits({ organizationId: ctx.organizationId, branchId: ctx.branch.id }),
    heldPermissionKeys(viewer.userId, ctx.organizationId),
    db.student.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null, status: "ENROLLED" },
      include: { currentSection: { include: { grade: true } } },
      orderBy: { firstName: "asc" },
      take: 300,
    }),
  ]);

  const hidden = { branchId: ctx.branch.id };
  const canEdit = held.has("ops.infirmary:edit");

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Infirmary"
        description={`${ctx.branch.name} · ${visits.length} recorded visit${visits.length === 1 ? "" : "s"}`}
        actions={<LinkButton href={withBranch("/operations", ctx)}>Back to Operations</LinkButton>}
      />

      <div className="rounded-md border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">Health information, behind its own permission</p>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          These records sit behind <code className="text-xs">ops.infirmary</code> rather than any general student-view grant — a teacher who can
          see a timetable has no automatic business reading a child&apos;s medical complaints.
        </p>
      </div>

      {canEdit ? (
        <Card title="Record a visit">
          <ActionForm action={recordClinicVisitAction} hidden={hidden} submitLabel="Record visit">
            <div className="flex flex-wrap gap-3">
              <Field label="Student" htmlFor="cv-student">
                <Select id="cv-student" name="studentId" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.firstName} {s.lastName}
                      {s.currentSection ? ` (${s.currentSection.grade.name}/${s.currentSection.name})` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Outcome" htmlFor="cv-outcome">
                <Select id="cv-outcome" name="outcome" defaultValue="RETURNED_TO_CLASS">
                  {CLINIC_OUTCOMES.map((o) => (
                    <option key={o} value={o}>
                      {CLINIC_OUTCOME_LABELS[o]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Temperature °C" htmlFor="cv-temp" hint="Optional">
                <Input id="cv-temp" name="temperatureCelsius" inputMode="decimal" placeholder="37.2" />
              </Field>
            </div>
            <Field label="Complaint" htmlFor="cv-complaint">
              <Input id="cv-complaint" name="complaint" required maxLength={500} placeholder="Headache and mild fever" />
            </Field>
            <Field label="Treatment given" htmlFor="cv-treatment">
              <Textarea id="cv-treatment" name="treatment" rows={2} maxLength={500} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" name="notifyGuardians" className="h-4 w-4" />
              Also tell the guardians
            </label>
          </ActionForm>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Sent home and referred to hospital always notify the guardians, tickbox or not. That message overrides quiet hours — a parent
            should not learn at 7am that their child was sent home at 9pm.
            {!hasDeliveringProvider() ? " No provider is configured, so it is recorded in the delivery log rather than delivered." : ""}
          </p>
        </Card>
      ) : null}

      <Card title="Visits">
        {visits.length === 0 ? (
          <EmptyState>No visits recorded.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {visits.map((v) => (
              <li key={v.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">
                    {v.student.firstName} {v.student.lastName}
                    <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                      {v.student.currentSection ? `${v.student.currentSection.grade.name}/${v.student.currentSection.name} · ` : ""}
                      {formatDate(v.visitedAt)}
                    </span>
                  </p>
                  <div className="flex items-center gap-2">
                    {v.guardianNotifiedAt ? <Badge tone="blue">guardian told</Badge> : null}
                    <Badge tone={OUTCOME_TONES[v.outcome]}>{CLINIC_OUTCOME_LABELS[v.outcome].toLowerCase()}</Badge>
                  </div>
                </div>
                <p className="mt-1 text-zinc-600 dark:text-zinc-300">
                  {v.complaint}
                  {v.temperatureCelsius ? ` · ${v.temperatureCelsius.toString()} °C` : ""}
                </p>
                {v.treatment ? <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">{v.treatment}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
