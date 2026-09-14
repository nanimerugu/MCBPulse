import { withBranch } from "@/lib/branch-context";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadAutomationAccess, param } from "@/modules/sis/access";
import { listRules } from "@/modules/automation/automation.service";
import {
  describeTrigger,
  EVENT_FIELDS,
  EVENT_LABELS,
  IMMEDIATE_EVENT_KINDS,
  isScheduledKind,
  OPERATORS,
  OPERATOR_LABELS,
  SCHEDULED_EVENT_KINDS,
  type Condition,
} from "@/modules/automation/rules";
import { formatDate } from "@/modules/sis/labels";
import { createRuleAction, deleteRuleAction, setRuleActiveAction } from "@/app/(app)/automation/actions";

export default async function AutomationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadAutomationAccess(param(sp, "branch"), "automation.rules", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Automation" />
        <AccessDenied result={result} permission="automation.rules:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const [rules, held] = await Promise.all([listRules(ctx.organizationId), heldPermissionKeys(viewer.userId, ctx.organizationId)]);

  const hidden = { branchId: ctx.branch.id };
  const canConfigure = held.has("automation.rules:configure");
  const allFields = [...new Set(Object.values(EVENT_FIELDS).flat())].sort();

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Automation"
        description="When something happens — or a date comes round — and a condition holds, send a message."
        actions={<LinkButton href={withBranch("/automation/scheduler", ctx)}>Scheduler</LinkButton>}
      />

      <div className="rounded-md border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">What this does and doesn&apos;t cover</p>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          This is the <strong>trigger → condition → action</strong> half of the blueprint&apos;s workflow engine. It does <strong>not</strong>{" "}
          replace the approvals already built into student leave, staff leave, refunds, admissions, payroll and report cards — rewriting six
          working approval flows to gain uniformity nobody has asked for would risk all six. Date-based triggers run on the{" "}
          <a className="underline" href={withBranch("/automation/scheduler", ctx)}>
            scheduler
          </a>
          , which acts on each invoice or loan at most once per rule.
        </p>
      </div>

      {canConfigure ? (
        <Card title="New rule">
          <ActionForm action={createRuleAction} hidden={hidden} submitLabel="Create rule">
            <div className="flex flex-wrap gap-3">
              <Field label="Name" htmlFor="ar-name">
                <Input id="ar-name" name="name" required maxLength={80} placeholder="Remind families before fees fall due" />
              </Field>
              <Field label="When" htmlFor="ar-event">
                <Select id="ar-event" name="eventKind" defaultValue={IMMEDIATE_EVENT_KINDS[0]}>
                  <optgroup label="When something happens">
                    {IMMEDIATE_EVENT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {EVENT_LABELS[k]}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="On a date (needs a number of days)">
                    {SCHEDULED_EVENT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {EVENT_LABELS[k]}
                      </option>
                    ))}
                  </optgroup>
                </Select>
              </Field>
              <Field label="Days" htmlFor="ar-days" hint="Date-based triggers only">
                <Input id="ar-days" name="offsetDays" type="number" min={1} max={180} placeholder="3" className="!w-24" />
              </Field>
              <Field label="Then" htmlFor="ar-action">
                <Select id="ar-action" name="action" defaultValue="NOTIFY_GUARDIANS">
                  <option value="NOTIFY_GUARDIANS">Message the guardians</option>
                  <option value="NOTIFY_USER">Notify me in the app</option>
                </Select>
              </Field>
            </div>

            <fieldset className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Only when — leave blank for every time
              </legend>
              {[0, 1, 2].map((i) => (
                <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
                  <Select name={`field${i}`} defaultValue="" aria-label={`Condition ${i + 1} field`} className="!w-56">
                    <option value="">—</option>
                    {allFields.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </Select>
                  <Select name={`operator${i}`} defaultValue="eq" aria-label={`Condition ${i + 1} comparison`} className="!w-40">
                    {OPERATORS.map((o) => (
                      <option key={o} value={o}>
                        {OPERATOR_LABELS[o]}
                      </option>
                    ))}
                  </Select>
                  <Input name={`value${i}`} maxLength={80} placeholder="value" aria-label={`Condition ${i + 1} value`} className="!w-40" />
                </div>
              ))}
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Fields differ per event; the list shows every field any event provides. A condition on a field the event doesn&apos;t carry
                is false, so the rule simply won&apos;t fire.
              </p>
            </fieldset>

            <Field label="Message" htmlFor="ar-body" hint="Use {{field}} placeholders — an unknown one is left visible so a broken rule looks broken.">
              <Textarea
                id="ar-body"
                name="messageBody"
                rows={2}
                required
                maxLength={1000}
                placeholder="Reminder: {{invoice.outstanding}} for {{student.name}} is due on {{invoice.dueDate}}."
              />
            </Field>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              &quot;Notify me&quot; notifies you, the person creating the rule — not whoever happens to trigger it.
            </p>
          </ActionForm>
        </Card>
      ) : null}

      <Card title={`Rules (${rules.length})`}>
        {rules.length === 0 ? (
          <EmptyState>No rules yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rules.map((r) => {
              const conditions = (r.conditions ?? []) as unknown as Condition[];
              const last = r.runs[0];
              return (
                <li key={r.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-zinc-900 dark:text-zinc-50">
                        {r.name}
                        {isScheduledKind(r.eventKind) ? (
                          <span className="ml-2 align-middle">
                            <Badge tone="blue">date-based</Badge>
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {describeTrigger(r.eventKind, r.offsetDays)}
                        {conditions.length > 0
                          ? ` · only when ${conditions.map((c) => `${c.field} ${OPERATOR_LABELS[c.operator]} ${c.value}`).join(" and ")}`
                          : " · every time"}
                        {" · "}
                        {r.action === "NOTIFY_GUARDIANS" ? "message the guardians" : "notify the rule's author in the app"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={r.active ? "green" : "neutral"}>{r.active ? "active" : "paused"}</Badge>
                      {canConfigure ? (
                        <>
                          <ActionForm
                            action={setRuleActiveAction.bind(null, r.id, !r.active)}
                            hidden={hidden}
                            submitLabel={r.active ? "Pause" : "Enable"}
                            inline
                          />
                          <ActionForm action={deleteRuleAction.bind(null, r.id)} hidden={hidden} submitLabel="Delete" variant="danger" inline />
                        </>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-1 text-zinc-600 dark:text-zinc-300">{r.messageBody}</p>
                  <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">
                    {r._count.runs} evaluation{r._count.runs === 1 ? "" : "s"}
                    {last ? ` · last ${last.outcome.toLowerCase()} ${formatDate(last.createdAt)}${last.detail ? ` — ${last.detail}` : ""}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Every evaluation is recorded, matched or not, so &quot;why didn&apos;t my rule fire?&quot; has an answer. A rule that throws never
          rolls back the payment or the register that triggered it. An overdue rule looks back no more than three days past its line, so
          creating one never messages every family with an old debt at once.
        </p>
      </Card>
    </div>
  );
}
