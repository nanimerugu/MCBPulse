import Link from "next/link";
import { notFound } from "next/navigation";
import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { Badge, Button, Card, DescriptionList, EmptyState, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadAdmissionsAccess, param } from "@/modules/sis/access";
import { formatDate } from "@/modules/sis/labels";
import { listEnrollableSections } from "@/modules/sis/students.service";
import {
  APPLICATION_DECISIONS,
  APPLICATION_STATUS_LABELS,
  LEAD_STAGES_OPEN_TO_APPLICATION,
  LEAD_STAGE_LABELS,
  applicationTransitions,
  manualLeadTransitions,
} from "@/modules/admissions/pipeline";
import { getLead, listCounselors } from "@/modules/admissions/leads.service";
import {
  addDocumentAction,
  addNoteAction,
  assignCounselorAction,
  convertApplicationAction,
  moveApplicationAction,
  moveLeadStageAction,
  openApplicationAction,
  scheduleAppointmentAction,
  setAppointmentStatusAction,
  setFollowUpAction,
  toggleDocumentAction,
} from "@/app/(app)/admissions/actions";
import type { ApplicationStatus, LeadStage } from "@/generated/prisma/enums";

const STAGE_TONES: Record<LeadStage, BadgeTone> = { NEW: "blue", CONTACTED: "neutral", QUALIFIED: "amber", APPLIED: "amber", ADMITTED: "green", LOST: "red" };
const APP_TONES: Record<ApplicationStatus, BadgeTone> = {
  DOCUMENTS_PENDING: "neutral",
  UNDER_REVIEW: "amber",
  WAITLISTED: "amber",
  OFFERED: "blue",
  ACCEPTED: "green",
  REJECTED: "red",
};

export default async function LeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const result = await loadAdmissionsAccess(param(sp, "branch"), "admissions.leads", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Lead" />
        <AccessDenied result={result} permission="admissions.leads:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const tenant = { organizationId: ctx.organizationId, branchId: ctx.branch.id };

  const data = await getLead(id, ctx.organizationId);
  if (!data) notFound();
  const { lead, counselor, timeline } = data;

  const [canEdit, canConfigure, canAppView, canAppCreate, canAppEdit, canApprove, canCreateStudent, counselors, sections] = await Promise.all([
    authorize(viewer.userId, "admissions.leads", "edit", tenant),
    authorize(viewer.userId, "admissions.leads", "configure", tenant),
    authorize(viewer.userId, "admissions.applications", "view", tenant),
    authorize(viewer.userId, "admissions.applications", "create", tenant),
    authorize(viewer.userId, "admissions.applications", "edit", tenant),
    authorize(viewer.userId, "admissions.applications", "approve", tenant),
    authorize(viewer.userId, "sis.students", "create", tenant),
    listCounselors(ctx.organizationId, ctx.branch.id),
    listEnrollableSections(lead.branchId ?? ctx.branch.id),
  ]);

  const hidden = { branchId: ctx.branch.id };
  const manualStages = manualLeadTransitions(lead.stage);
  const hasOpenApplication = lead.applications.some((a) => !["REJECTED"].includes(a.status));
  const canOpenApplication = canAppCreate && !hasOpenApplication && (LEAD_STAGES_OPEN_TO_APPLICATION.has(lead.stage) || lead.stage === "APPLIED");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={lead.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={STAGE_TONES[lead.stage]}>{LEAD_STAGE_LABELS[lead.stage]}</Badge>
            <span className="font-mono text-xs">{lead.phone}</span>
            {lead.email ? <span>· {lead.email}</span> : null}
            <span>· {lead.source?.name ?? "no source"}</span>
            {lead.campaign ? <span>· {lead.campaign.name}</span> : null}
            <span>· {lead.branch?.name ?? ctx.branch.name}</span>
          </span>
        }
        actions={<LinkButton href={withBranch("/admissions/leads", ctx)}>← All leads</LinkButton>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {canAppView ? (
            <Card title={`Applications (${lead.applications.length})`}>
              {lead.applications.length === 0 ? <EmptyState>No application yet.</EmptyState> : null}
              <div className="flex flex-col gap-6">
                {lead.applications.map((app) => {
                  const nexts = applicationTransitions(app.status).filter((s) => canApprove || !APPLICATION_DECISIONS.has(s));
                  return (
                    <div key={app.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium text-zinc-900 dark:text-zinc-50">
                            {app.applicantName} <span className="text-zinc-500 dark:text-zinc-400">· {app.gradeAppliedFor}</span>
                          </p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Opened {formatDate(app.submittedAt)}
                            {app.decidedAt ? ` · decided ${formatDate(app.decidedAt)}` : ""}
                          </p>
                        </div>
                        <Badge tone={APP_TONES[app.status]}>{APPLICATION_STATUS_LABELS[app.status]}</Badge>
                      </div>

                      {app.convertedStudentId ? (
                        <p className="mt-3 text-sm">
                          Converted —{" "}
                          <Link href={withBranch(`/students/${app.convertedStudentId}`, ctx)} className="underline">
                            open the student record
                          </Link>
                        </p>
                      ) : null}

                      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Document checklist</h4>
                          {app.documents.length === 0 ? (
                            <p className="text-sm text-zinc-500 dark:text-zinc-400">Nothing on the checklist.</p>
                          ) : (
                            <ul className="flex flex-col gap-1 text-sm">
                              {app.documents.map((d) => (
                                <li key={d.id} className="flex items-center justify-between gap-2">
                                  <span className={d.verified ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-600 dark:text-zinc-300"}>
                                    {d.verified ? "✓ " : "○ "}
                                    {d.documentType}
                                  </span>
                                  {canAppEdit && !app.convertedStudentId ? (
                                    <form action={toggleDocumentAction}>
                                      <input type="hidden" name="branchId" value={ctx.branch.id} />
                                      <input type="hidden" name="leadId" value={lead.id} />
                                      <input type="hidden" name="documentId" value={d.id} />
                                      <input type="hidden" name="verified" value={d.verified ? "false" : "true"} />
                                      <Button type="submit" variant="secondary" className="!px-2 !py-0.5 text-xs">
                                        {d.verified ? "Unverify" : "Verify"}
                                      </Button>
                                    </form>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          )}
                          {canAppEdit && !app.convertedStudentId && !["ACCEPTED", "REJECTED"].includes(app.status) ? (
                            <div className="mt-2">
                              <ActionForm action={addDocumentAction.bind(null, app.id, lead.id)} hidden={hidden} submitLabel="Add" inline>
                                <Input name="documentType" placeholder="e.g. Birth certificate" required className="w-56" aria-label="Document type" />
                              </ActionForm>
                            </div>
                          ) : null}
                        </div>

                        <div>
                          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Appointments</h4>
                          {app.appointments.length === 0 ? (
                            <p className="text-sm text-zinc-500 dark:text-zinc-400">None scheduled.</p>
                          ) : (
                            <ul className="flex flex-col gap-1 text-sm">
                              {app.appointments.map((ap) => (
                                <li key={ap.id} className="flex items-center justify-between gap-2">
                                  <span className="text-zinc-900 dark:text-zinc-50">
                                    {ap.type === "INTERVIEW" ? "Interview" : "Counseling"} · {ap.scheduledAt.toISOString().slice(0, 16).replace("T", " ")}{" "}
                                    <Badge tone={ap.status === "COMPLETED" ? "green" : ap.status === "SCHEDULED" ? "blue" : "neutral"}>{ap.status.toLowerCase().replace("_", " ")}</Badge>
                                  </span>
                                  {canAppEdit && ap.status === "SCHEDULED" ? (
                                    <div className="flex gap-1">
                                      {(["COMPLETED", "NO_SHOW", "CANCELLED"] as const).map((s) => (
                                        <form key={s} action={setAppointmentStatusAction}>
                                          <input type="hidden" name="branchId" value={ctx.branch.id} />
                                          <input type="hidden" name="leadId" value={lead.id} />
                                          <input type="hidden" name="appointmentId" value={ap.id} />
                                          <input type="hidden" name="status" value={s} />
                                          <Button type="submit" variant="secondary" className="!px-2 !py-0.5 text-xs">
                                            {s === "COMPLETED" ? "Done" : s === "NO_SHOW" ? "No-show" : "Cancel"}
                                          </Button>
                                        </form>
                                      ))}
                                    </div>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          )}
                          {canAppEdit && !["ACCEPTED", "REJECTED"].includes(app.status) ? (
                            <div className="mt-2">
                              <ActionForm action={scheduleAppointmentAction.bind(null, app.id, lead.id)} hidden={hidden} submitLabel="Schedule" inline>
                                <Select name="type" defaultValue="INTERVIEW" className="w-36" aria-label="Type">
                                  <option value="INTERVIEW">Interview</option>
                                  <option value="COUNSELING">Counseling</option>
                                </Select>
                                <Input name="scheduledAt" type="datetime-local" required className="w-52" aria-label="When" />
                              </ActionForm>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {canAppEdit && nexts.length > 0 ? (
                        <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Move application</h4>
                          <ActionForm action={moveApplicationAction.bind(null, app.id, lead.id)} hidden={hidden} submitLabel="Apply" inline>
                            <Select name="status" defaultValue={nexts[0]} className="w-44" aria-label="Next status">
                              {nexts.map((s) => (
                                <option key={s} value={s}>
                                  → {APPLICATION_STATUS_LABELS[s]}
                                </option>
                              ))}
                            </Select>
                            <Input name="note" placeholder="Note (optional)" className="w-64" aria-label="Note" />
                          </ActionForm>
                          {!canApprove ? (
                            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Offer / waitlist / accept / reject need admissions.applications:approve.</p>
                          ) : null}
                        </div>
                      ) : null}

                      {app.status === "ACCEPTED" && !app.convertedStudentId && canApprove && canCreateStudent ? (
                        <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Admit as student</h4>
                          <ActionForm action={convertApplicationAction.bind(null, app.id, lead.id)} hidden={hidden} submitLabel="Create student record" pendingLabel="Creating…" variant="primary">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                              <Field label="Admission number" htmlFor={`adm-${app.id}`}>
                                <Input id={`adm-${app.id}`} name="admissionNumber" required />
                              </Field>
                              <Field label="Section (optional)" htmlFor={`sec-${app.id}`} hint="With a section they're enrolled; without, they're 'applied'.">
                                <Select id={`sec-${app.id}`} name="sectionId" defaultValue="">
                                  <option value="">— place later —</option>
                                  {sections.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.grade.name} / {s.name}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                              <Field label={`${lead.name} is the child's`} htmlFor={`rel-${app.id}`}>
                                <Select id={`rel-${app.id}`} name="guardianRelationship" defaultValue="MOTHER">
                                  <option value="MOTHER">Mother</option>
                                  <option value="FATHER">Father</option>
                                  <option value="GUARDIAN">Guardian</option>
                                  <option value="OTHER">Other</option>
                                </Select>
                              </Field>
                            </div>
                          </ActionForm>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {canOpenApplication ? (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-200">Open an application</summary>
                  <div className="mt-3">
                    <ActionForm action={openApplicationAction.bind(null, lead.id)} hidden={hidden} submitLabel="Open application">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Applicant (child) name" htmlFor="app-name">
                          <Input id="app-name" name="applicantName" required />
                        </Field>
                        <Field label="Grade applied for" htmlFor="app-grade">
                          <Input id="app-grade" name="gradeAppliedFor" placeholder="e.g. Grade 5" required />
                        </Field>
                      </div>
                    </ActionForm>
                  </div>
                </details>
              ) : null}
            </Card>
          ) : null}

          <Card title="Timeline">
            {timeline.length === 0 ? (
              <EmptyState>No activity yet.</EmptyState>
            ) : (
              <ol className="flex flex-col gap-3 text-sm">
                {timeline.map((ev) => (
                  <li key={ev.id} className="border-l-2 border-zinc-200 pl-3 dark:border-zinc-800">
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">{ev.action.replace(/^(lead|application)\./, "").replace(/_/g, " ")}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {ev.createdAt.toISOString().replace("T", " ").slice(0, 16)} · {ev.actorUser?.name ?? (ev.actorUserId ? "unknown" : "public form")}
                    </p>
                    {ev.after ? <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs text-zinc-600 dark:text-zinc-300">{JSON.stringify(ev.after)}</pre> : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card title="Pipeline">
            <DescriptionList
              items={[
                { label: "Stage", value: LEAD_STAGE_LABELS[lead.stage] },
                { label: "Counselor", value: counselor?.name ?? "Unassigned" },
                { label: "Next follow-up", value: formatDate(lead.nextFollowUpAt) },
                { label: "Created", value: formatDate(lead.createdAt) },
              ]}
            />
            {canConfigure && manualStages.length > 0 ? (
              <div className="mt-4">
                <ActionForm action={moveLeadStageAction.bind(null, lead.id)} hidden={hidden} submitLabel="Move">
                  <Field label="Move to" htmlFor="stage">
                    <Select id="stage" name="stage" defaultValue={manualStages[0]}>
                      {manualStages.map((s) => (
                        <option key={s} value={s}>
                          {LEAD_STAGE_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Input name="note" placeholder="Why (optional)" aria-label="Note" />
                </ActionForm>
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Applied and Admitted are set by opening an application and admitting, not by hand.</p>
              </div>
            ) : null}
          </Card>

          {canConfigure ? (
            <Card title="Assignment">
              <ActionForm action={assignCounselorAction.bind(null, lead.id)} hidden={hidden} submitLabel="Assign" inline>
                <Select name="counselorUserId" defaultValue={lead.assignedCounselorUserId ?? ""} className="w-56" aria-label="Counselor">
                  <option value="">Unassigned</option>
                  {counselors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.role}
                    </option>
                  ))}
                </Select>
              </ActionForm>
            </Card>
          ) : null}

          {canEdit ? (
            <Card title="Follow-up">
              <ActionForm action={setFollowUpAction.bind(null, lead.id)} hidden={hidden} submitLabel="Save" inline>
                <Input name="nextFollowUpAt" type="date" defaultValue={lead.nextFollowUpAt?.toISOString().slice(0, 10) ?? ""} className="w-44" aria-label="Next follow-up" />
              </ActionForm>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Clear the date to remove the follow-up.</p>
            </Card>
          ) : null}

          {canEdit ? (
            <Card title="Add a note">
              <ActionForm action={addNoteAction.bind(null, lead.id)} hidden={hidden} submitLabel="Add note">
                <Textarea name="note" rows={3} required placeholder="Call summary, what they asked, next step…" aria-label="Note" />
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
