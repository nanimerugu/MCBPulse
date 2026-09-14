import { authorize } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadConnectAccess, param } from "@/modules/sis/access";
import { withBranch } from "@/lib/branch-context";
import { listTemplates } from "@/modules/connect/templates.service";
import { TEMPLATE_VARIABLES, TEMPLATE_VARIABLE_KEYS, smsSegments } from "@/modules/connect/templates";
import { CHANNEL_LABELS } from "@/modules/connect/delivery-policy";
import { createTemplateAction } from "@/app/(app)/connect/actions";

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadConnectAccess(param(sp, "branch"), "connect.templates", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Templates" />
        <AccessDenied result={result} permission="connect.templates:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;
  const [templates, canCreate] = await Promise.all([
    listTemplates(ctx.organizationId),
    authorize(viewer.userId, "connect.templates", "create", { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
  ]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Templates" description="Reusable message bodies. Organization-wide." actions={<LinkButton href={withBranch("/connect", ctx)}>← Communication</LinkButton>} />

      <Card title={`Templates (${templates.length})`}>
        {templates.length === 0 ? (
          <EmptyState>No templates yet.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {templates.map((t) => (
              <li key={t.id} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">{t.name}</span>
                  <span className="flex items-center gap-2 text-xs text-zinc-500">
                    <Badge tone="blue">{CHANNEL_LABELS[t.channel]}</Badge>
                    {t.channel === "SMS" ? <>{smsSegments(t.body)} segment{smsSegments(t.body) === 1 ? "" : "s"} ·</> : null} used by {t._count.broadcasts} broadcast
                    {t._count.broadcasts === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">{t.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Available variables">
        <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          Only these may appear in a template. Anything else is rejected when you save — a template can&apos;t be used to read arbitrary student data.
        </p>
        <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
          {TEMPLATE_VARIABLE_KEYS.map((k) => (
            <li key={k}>
              <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-800">{`{{${k}}}`}</code>{" "}
              <span className="text-zinc-500 dark:text-zinc-400">{TEMPLATE_VARIABLES[k]}</span>
            </li>
          ))}
        </ul>
      </Card>

      {canCreate ? (
        <Card title="New template">
          <ActionForm action={createTemplateAction} hidden={{ branchId: ctx.branch.id }} submitLabel="Save template" variant="primary">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name" htmlFor="t-name">
                <Input id="t-name" name="name" placeholder="e.g. Fee reminder" required />
              </Field>
              <Field label="Channel" htmlFor="t-channel">
                <Select id="t-channel" name="channel" defaultValue="SMS">
                  <option value="SMS">SMS</option>
                  <option value="EMAIL">Email</option>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="PUSH">Push</option>
                  <option value="VOICE">Voice</option>
                </Select>
              </Field>
            </div>
            <Field label="Body" htmlFor="t-body" hint="Use the variables listed above, e.g. {{student.first_name}}.">
              <Textarea id="t-body" name="body" rows={3} required />
            </Field>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
