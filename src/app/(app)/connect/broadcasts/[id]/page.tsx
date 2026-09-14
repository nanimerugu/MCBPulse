import { notFound } from "next/navigation";
import { withBranch } from "@/lib/branch-context";
import { authorize } from "@/lib/rbac";
import { Badge, Card, DescriptionList, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadConnectAccess, param } from "@/modules/sis/access";
import { getBroadcast, previewBroadcast } from "@/modules/connect/broadcasts.service";
import { AUDIENCE_LABELS, parseAudience } from "@/modules/connect/audience";
import { CHANNEL_LABELS } from "@/modules/connect/delivery-policy";
import { smsSegments } from "@/modules/connect/templates";
import { formatDate } from "@/modules/sis/labels";
import { sendBroadcastAction } from "@/app/(app)/connect/actions";

export default async function BroadcastPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const result = await loadConnectAccess(param(sp, "branch"), "connect.broadcasts", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Broadcast" />
        <AccessDenied result={result} permission="connect.broadcasts:view" />
      </>
    );
  }
  const { viewer, ctx } = result.access;

  const data = await getBroadcast(id, ctx.organizationId);
  if (!data) notFound();
  const { broadcast, counts } = data;

  const scope = {
    organizationId: ctx.organizationId,
    branchId: ctx.branch.id,
    branchName: ctx.branch.name,
    organizationName: viewer.assignments[0]?.organization.name ?? "School",
  };

  const alreadySent = broadcast.status === "SENT" || broadcast.status === "SENDING";
  const [preview, canSend] = await Promise.all([
    alreadySent ? Promise.resolve(null) : previewBroadcast(id, scope).catch(() => null),
    authorize(viewer.userId, "connect.broadcasts", "message", { organizationId: ctx.organizationId, branchId: ctx.branch.id }),
  ]);

  const spec = parseAudience(broadcast.audience);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={broadcast.subject || "Broadcast"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={broadcast.status === "SENT" ? "green" : broadcast.status === "FAILED" ? "red" : broadcast.status === "SCHEDULED" ? "amber" : "neutral"}>
              {broadcast.status.toLowerCase()}
            </Badge>
            <span>{CHANNEL_LABELS[broadcast.channel]}</span>
            <span>· {spec ? AUDIENCE_LABELS[spec.kind] : "unreadable audience"}</span>
            {broadcast.scheduledAt ? <span>· scheduled {formatDate(broadcast.scheduledAt)}</span> : null}
            {broadcast.sentAt ? <span>· sent {formatDate(broadcast.sentAt)}</span> : null}
          </span>
        }
        actions={<LinkButton href={withBranch("/connect/broadcasts", ctx)}>← Broadcasts</LinkButton>}
      />

      <Card title="Message">
        <p className="whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-100">{broadcast.body}</p>
        {broadcast.channel === "SMS" ? (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {smsSegments(broadcast.body)} SMS segment{smsSegments(broadcast.body) === 1 ? "" : "s"} before variables are filled in.
          </p>
        ) : null}
      </Card>

      {preview ? (
        <Card title="Before you send">
          <DescriptionList
            items={[
              { label: "Will send to", value: `${preview.willSend} recipient${preview.willSend === 1 ? "" : "s"}` },
              { label: "Suppressed", value: preview.suppressed.length },
              { label: "Quiet hours now", value: preview.quietHoursNow ? `Yes — would defer to ${preview.deferUntil?.toISOString().slice(0, 16).replace("T", " ")} UTC` : "No" },
              { label: "Provider", value: preview.providerDelivers ? "Live" : "Recorded only (not delivered)" },
            ]}
          />

          {preview.sample ? (
            <div className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Rendered for {preview.sample.name} ({preview.sample.address})
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-50">{preview.sample.text}</p>
              {preview.sample.missing.length > 0 ? (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  No value for: {preview.sample.missing.join(", ")} — these render blank.
                </p>
              ) : null}
            </div>
          ) : (
            <EmptyState>Nobody in this audience can be contacted on that channel.</EmptyState>
          )}

          {preview.suppressed.length > 0 ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-zinc-600 dark:text-zinc-300">Who won&apos;t receive it ({preview.suppressed.length})</summary>
              <ul className="mt-2 flex flex-col gap-1 text-xs">
                {preview.suppressed.slice(0, 50).map((s, i) => (
                  <li key={`${s.name}-${i}`} className="text-zinc-600 dark:text-zinc-300">
                    {s.name} {s.address ? <span className="font-mono">{s.address}</span> : null} — {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {canSend && preview.willSend > 0 ? (
            <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <ActionForm
                action={sendBroadcastAction.bind(null, broadcast.id)}
                hidden={{ branchId: ctx.branch.id }}
                submitLabel={preview.quietHoursNow ? "Send anyway (overrides quiet hours)" : `Send to ${preview.willSend}`}
                pendingLabel="Sending…"
                variant="primary"
              >
                {preview.quietHoursNow ? <input type="hidden" name="ignoreQuietHours" value="true" /> : null}
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {preview.providerDelivers
                    ? "This will really contact these people."
                    : "No delivery provider is configured: each message is written to the delivery log and marked recorded, but nothing leaves the system."}
                </p>
              </ActionForm>
            </div>
          ) : null}
        </Card>
      ) : null}

      {broadcast.messages.length > 0 ? (
        <Card title={`Messages (${broadcast.messages.length})`}>
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            {Object.entries(counts)
              .map(([k, v]) => `${v} ${k.toLowerCase()}`)
              .join(" · ")}
          </p>
          <div className="max-h-96 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-zinc-50 uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Recipient</th>
                  <th className="px-3 py-2 font-medium">Address</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Body</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {broadcast.messages.map((m) => (
                  <tr key={m.id}>
                    <td className="px-3 py-1.5">{m.recipientName ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono">{m.recipientAddress}</td>
                    <td className="px-3 py-1.5">
                      <Badge tone={m.status === "SENT" || m.status === "DELIVERED" ? "green" : m.status === "FAILED" ? "red" : "neutral"}>{m.status.toLowerCase()}</Badge>
                      {m.provider ? <span className="ml-1 text-zinc-400">{m.provider}</span> : null}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-300">{m.body}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
