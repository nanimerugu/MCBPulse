import Link from "next/link";
import { notFound } from "next/navigation";
import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { Badge, Button, Card, DescriptionList, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadSisAccess, param } from "@/modules/sis/access";
import { GUARDIAN_RELATIONSHIP_LABELS, STUDENT_STATUS_LABELS, STUDENT_STATUS_TONES, formatDate, fullName } from "@/modules/sis/labels";
import { allowedActions } from "@/modules/sis/lifecycle";
import { getStudent360, listEnrollableSections } from "@/modules/sis/students.service";
import { getSectionScope, sectionInScope } from "@/modules/academics/scope";
import { studentAttendanceCounts } from "@/modules/academics/attendance.service";
import { listStudentLeave } from "@/modules/academics/leave.service";
import { formatRate } from "@/modules/academics/attendance-summary";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { db } from "@/lib/db";
import {
  addEmergencyContactAction,
  archiveStudentAction,
  lifecycleAction,
  linkGuardianAction,
  removeEmergencyContactAction,
  unlinkGuardianAction,
} from "@/app/(app)/students/actions";
import { createLeaveAction, decideLeaveAction } from "@/app/(app)/academics/actions";
import { LifecycleForm } from "@/app/(app)/students/[id]/lifecycle-form";
import { GuardianForm, type ExistingGuardianOption } from "@/app/(app)/students/[id]/guardian-form";
import { EmergencyContactForm } from "@/app/(app)/students/[id]/emergency-contact-form";
import { LeaveForm } from "@/app/(app)/students/[id]/leave-form";
import { ActionForm } from "@/components/action-form";
import { Field, Input, Select } from "@/components/ui";
import { studentFeeSummary } from "@/modules/finance/invoices.service";
import { listConcessions, listFeeStructures } from "@/modules/finance/fees.service";
import { INVOICE_STATUS_LABELS, formatMoney, toMinor } from "@/modules/finance/money";
import { grantConcessionAction, raiseInvoiceAction } from "@/app/(app)/finance/actions";

export default async function StudentProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const result = await loadSisAccess(param(sp, "branch"), "sis.students", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Student" />
        <AccessDenied result={result} permission="sis.students:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const scope = { organizationId: ctx.organizationId, branchId: ctx.branch.id };

  const data = await getStudent360(id, ctx.organizationId);
  if (!data) notFound();
  const { student, timeline } = data;

  // Attribute policy: teachers only reach students in sections they teach.
  const sectionScope = await getSectionScope(result.access);
  if (!sectionInScope(sectionScope, student.currentSectionId)) {
    return (
      <>
        <PageHeader title="Student" />
        <EmptyState>This student isn&apos;t in one of your assigned sections.</EmptyState>
      </>
    );
  }

  const [academicsOn, financeOn] = await Promise.all([
    isFeatureEnabled("phase2.academics", ctx.organizationId),
    isFeatureEnabled("phase4.finance", ctx.organizationId),
  ]);
  const feeYearId = student.currentSection?.academicYearId ?? ctx.academicYear?.id ?? null;
  const [fees, concessions, feeStructures, canViewFees, canRaiseInvoice, canGrantConcession] = financeOn
    ? await Promise.all([
        studentFeeSummary(student.id, ctx.organizationId),
        listConcessions(student.id, ctx.organizationId),
        feeYearId ? listFeeStructures(student.branchId, feeYearId) : Promise.resolve([]),
        authorize(viewer.userId, "finance.invoices", "view", scope),
        authorize(viewer.userId, "finance.invoices", "create", scope),
        authorize(viewer.userId, "finance.concessions", "approve", scope),
      ])
    : [null, [], [], false, false, false];
  const [canEdit, canEnroll, canGuardians, canUnlinkGuardian, canArchive, canApproveLeave, sections, attendance, leave] = await Promise.all([
    authorize(viewer.userId, "sis.students", "edit", scope),
    authorize(viewer.userId, "sis.enrollment", "edit", scope),
    authorize(viewer.userId, "sis.guardians", "create", scope),
    authorize(viewer.userId, "sis.guardians", "delete", scope),
    authorize(viewer.userId, "sis.students", "delete", scope),
    academicsOn ? authorize(viewer.userId, "academics.attendance", "approve", scope) : Promise.resolve(false),
    listEnrollableSections(student.branchId),
    academicsOn ? studentAttendanceCounts(student.id, student.currentSection?.academicYear.startDate.toISOString().slice(0, 10) ?? null) : Promise.resolve(null),
    academicsOn ? listStudentLeave(student.id, ctx.organizationId) : Promise.resolve([]),
  ]);

  // Guardians already on other students in this org, for sibling linking.
  const linkedIds = new Set(student.guardianLinks.map((l) => l.guardianId));
  const siblingGuardians: ExistingGuardianOption[] = canGuardians
    ? (
        await db.guardian.findMany({
          where: {
            deletedAt: null,
            id: { notIn: [...linkedIds] },
            studentLinks: { some: { student: { organizationId: ctx.organizationId, deletedAt: null } } },
          },
          include: { studentLinks: { include: { student: { select: { firstName: true, lastName: true, admissionNumber: true } } }, take: 2 } },
          orderBy: { lastName: "asc" },
          take: 200,
        })
      ).map((g) => ({
        id: g.id,
        label: `${fullName(g)} · ${g.phone} · ${g.studentLinks.map((l) => `${fullName(l.student)} (${l.student.admissionNumber})`).join(", ")}`,
      }))
    : [];

  const actions = allowedActions(student.status);
  const sectionOptions = sections.map((s) => ({ id: s.id, label: `${s.grade.name} / ${s.name}` }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={fullName(student)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{student.admissionNumber}</span>
            <Badge tone={STUDENT_STATUS_TONES[student.status]}>{STUDENT_STATUS_LABELS[student.status]}</Badge>
            <span>
              {student.currentSection
                ? `${student.currentSection.grade.name} / ${student.currentSection.name} · ${student.currentSection.academicYear.name}`
                : "Not placed in a section"}
            </span>
            <span>· {student.branch.name}</span>
            {attendance && attendance.total > 0 ? (
              <span>
                · attendance {formatRate(attendance.attendedRate)} ({attendance.present + attendance.late}/{attendance.total - attendance.excused})
              </span>
            ) : null}
          </span>
        }
        actions={
          <>
            <LinkButton href={withBranch("/students", ctx)}>← All students</LinkButton>
            {canEdit ? (
              <LinkButton href={withBranch(`/students/${student.id}/edit`, ctx)} variant="primary">
                Edit
              </LinkButton>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card title="Details">
            <DescriptionList
              items={[
                { label: "Date of birth", value: formatDate(student.dateOfBirth) },
                { label: "Gender", value: student.gender },
                { label: "Admission date", value: formatDate(student.admissionDate) },
                { label: "Blood group", value: student.bloodGroup },
                {
                  label: "Address",
                  value: [student.addressLine1, student.addressLine2, student.city, student.state, student.postalCode].filter(Boolean).join(", ") || null,
                },
                { label: "Medical notes", value: student.medicalNotes },
              ]}
            />
          </Card>

          <Card title="Guardians">
            {student.guardianLinks.length === 0 ? (
              <EmptyState>No guardians linked.</EmptyState>
            ) : (
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {student.guardianLinks.map((link) => (
                  <li key={link.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                    <div>
                      <p className="font-medium text-zinc-900 dark:text-zinc-50">
                        {fullName(link.guardian)}{" "}
                        <span className="text-zinc-500 dark:text-zinc-400">· {GUARDIAN_RELATIONSHIP_LABELS[link.relationship]}</span>
                        {link.isPrimary ? (
                          <>
                            {" "}
                            <Badge tone="blue">Primary</Badge>
                          </>
                        ) : null}
                      </p>
                      <p className="text-zinc-500 dark:text-zinc-400">
                        {link.guardian.phone}
                        {link.guardian.email ? ` · ${link.guardian.email}` : ""}
                        {link.guardian.occupation ? ` · ${link.guardian.occupation}` : ""}
                      </p>
                    </div>
                    {canUnlinkGuardian ? (
                      <form action={unlinkGuardianAction}>
                        <input type="hidden" name="branchId" value={ctx.branch.id} />
                        <input type="hidden" name="studentId" value={student.id} />
                        <input type="hidden" name="linkId" value={link.id} />
                        <Button type="submit" variant="danger" className="!px-2.5 !py-1 text-xs">
                          Unlink
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canGuardians ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-200">Link a guardian</summary>
                <div className="mt-3">
                  <GuardianForm action={linkGuardianAction.bind(null, student.id)} branchId={ctx.branch.id} existing={siblingGuardians} />
                </div>
              </details>
            ) : null}
          </Card>

          <Card title="Emergency contacts">
            {student.emergencyContacts.length === 0 ? (
              <EmptyState>None recorded.</EmptyState>
            ) : (
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {student.emergencyContacts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                    <span className="text-zinc-900 dark:text-zinc-50">
                      {c.name} <span className="text-zinc-500 dark:text-zinc-400">· {c.relationship} · {c.phone}</span>
                    </span>
                    {canEdit ? (
                      <form action={removeEmergencyContactAction}>
                        <input type="hidden" name="branchId" value={ctx.branch.id} />
                        <input type="hidden" name="studentId" value={student.id} />
                        <input type="hidden" name="contactId" value={c.id} />
                        <Button type="submit" variant="danger" className="!px-2.5 !py-1 text-xs">
                          Remove
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canEdit ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-200">Add a contact</summary>
                <div className="mt-3">
                  <EmergencyContactForm action={addEmergencyContactAction.bind(null, student.id)} branchId={ctx.branch.id} />
                </div>
              </details>
            ) : null}
          </Card>

          {financeOn && canViewFees && fees ? (
            <Card title="Fees">
              <DescriptionList
                items={[
                  { label: "Invoiced", value: formatMoney(fees.invoicedMinor) },
                  { label: "Paid", value: formatMoney(fees.paidMinor) },
                  { label: "Outstanding", value: <span className="font-semibold">{formatMoney(fees.outstandingMinor)}</span> },
                  { label: "Concessions", value: concessions.length ? formatMoney(concessions.reduce((s, c) => s + toMinor(c.amount), 0)) : "—" },
                ]}
              />
              {fees.invoices.length > 0 ? (
                <ul className="mt-4 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                  {fees.invoices.map((inv) => (
                    <li key={inv.id} className="flex items-center justify-between py-1.5">
                      <Link href={withBranch(`/finance/invoices/${inv.id}`, ctx)} className="font-mono text-xs text-zinc-900 hover:underline dark:text-zinc-50">
                        {inv.invoiceNumber}
                      </Link>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {inv.feeStructure?.name ?? "ad hoc"} · due {formatDate(inv.dueDate)}
                      </span>
                      <span className="flex items-center gap-2 text-xs">
                        <span className="font-mono">{formatMoney(inv.outstandingMinor)} due</span>
                        <Badge tone={inv.displayStatus === "PAID" ? "green" : inv.displayStatus === "OVERDUE" ? "red" : inv.displayStatus === "PARTIAL" ? "amber" : "neutral"}>
                          {INVOICE_STATUS_LABELS[inv.displayStatus]}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">No invoices yet.</p>
              )}
              {canRaiseInvoice && feeStructures.length > 0 ? (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-200">Raise an invoice</summary>
                  <div className="mt-3">
                    <ActionForm action={raiseInvoiceAction.bind(null, student.id)} hidden={{ branchId: ctx.branch.id }} submitLabel="Raise invoice" inline>
                      <Field label="Fee structure" htmlFor="inv-structure">
                        <Select id="inv-structure" name="feeStructureId" required defaultValue={feeStructures[0].id} className="w-72">
                          {feeStructures.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} · {formatMoney(s.totalMinor)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Due date" htmlFor="inv-due">
                        <Input id="inv-due" name="dueDate" type="date" required className="w-44" />
                      </Field>
                    </ActionForm>
                  </div>
                </details>
              ) : null}
              {canGrantConcession ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-200">Grant a concession</summary>
                  <div className="mt-3">
                    <ActionForm action={grantConcessionAction.bind(null, student.id)} hidden={{ branchId: ctx.branch.id }} submitLabel="Grant" inline>
                      <Input name="amount" placeholder="Amount" required className="w-32" aria-label="Concession amount" inputMode="decimal" />
                      <Input name="reason" placeholder="Reason (e.g. sibling discount)" required className="w-64" aria-label="Reason" />
                      <Select name="feeStructureId" defaultValue="" className="w-56" aria-label="Applies to">
                        <option value="">Any structure</option>
                        {feeStructures.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </ActionForm>
                    {concessions.length > 0 ? (
                      <ul className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {concessions.map((c) => (
                          <li key={c.id}>
                            {formatMoney(toMinor(c.amount))} · {c.reason} · {c.feeStructure?.name ?? "any structure"}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </Card>
          ) : null}

          {academicsOn ? (
            <Card title="Leave">
              {leave.length === 0 ? (
                <EmptyState>No leave recorded.</EmptyState>
              ) : (
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {leave.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                      <div>
                        <p className="text-zinc-900 dark:text-zinc-50">
                          {formatDate(l.fromDate)} → {formatDate(l.toDate)}{" "}
                          <Badge tone={l.status === "APPROVED" ? "green" : l.status === "REJECTED" ? "red" : "amber"}>{l.status}</Badge>
                        </p>
                        <p className="text-zinc-500 dark:text-zinc-400">{l.reason}</p>
                      </div>
                      {canApproveLeave && l.status === "PENDING" ? (
                        <div className="flex gap-2">
                          {(["APPROVED", "REJECTED"] as const).map((decision) => (
                            <form key={decision} action={decideLeaveAction}>
                              <input type="hidden" name="branchId" value={ctx.branch.id} />
                              <input type="hidden" name="studentId" value={student.id} />
                              <input type="hidden" name="leaveId" value={l.id} />
                              <input type="hidden" name="decision" value={decision} />
                              <Button type="submit" variant={decision === "APPROVED" ? "secondary" : "danger"} className="!px-2.5 !py-1 text-xs">
                                {decision === "APPROVED" ? "Approve" : "Reject"}
                              </Button>
                            </form>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit ? (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-200">Record leave</summary>
                  <div className="mt-3">
                    <LeaveForm action={createLeaveAction.bind(null, student.id)} branchId={ctx.branch.id} />
                  </div>
                </details>
              ) : null}
              <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Approved leave pre-fills the day&apos;s register as Excused and doesn&apos;t count against attendance.</p>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <Card title="Enrollment">
            {canEnroll ? (
              <LifecycleForm action={lifecycleAction.bind(null, student.id)} branchId={ctx.branch.id} allowed={actions} sections={sectionOptions} />
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                You can view but not change enrollment (<code className="text-xs">sis.enrollment:edit</code>).
              </p>
            )}
            {canEnroll && sectionOptions.length === 0 ? (
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
                No sections exist for the current academic year —{" "}
                <Link href="/settings/academic-structure" className="underline">
                  set up grades and sections
                </Link>{" "}
                first.
              </p>
            ) : null}
          </Card>

          <Card title="Timeline">
            {timeline.length === 0 ? (
              <EmptyState>No events yet.</EmptyState>
            ) : (
              <ol className="flex flex-col gap-3 text-sm">
                {timeline.map((ev) => (
                  <li key={ev.id} className="border-l-2 border-zinc-200 pl-3 dark:border-zinc-800">
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">{ev.action.replace(/^(student|guardian|leave)\./, "").replace(/_/g, " ")}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {ev.createdAt.toISOString().replace("T", " ").slice(0, 16)} · {ev.actorUser?.name ?? "system"}
                    </p>
                    {ev.after ? (
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs text-zinc-600 dark:text-zinc-300">
                        {JSON.stringify(ev.after)}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {canArchive && student.status !== "ENROLLED" ? (
            <Card title="Danger zone">
              <form action={archiveStudentAction} className="flex flex-col gap-2">
                <input type="hidden" name="branchId" value={ctx.branch.id} />
                <input type="hidden" name="studentId" value={student.id} />
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Archiving hides the record from every list. The audit trail is kept.</p>
                <div>
                  <Button type="submit" variant="danger">
                    Archive student
                  </Button>
                </div>
              </form>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
