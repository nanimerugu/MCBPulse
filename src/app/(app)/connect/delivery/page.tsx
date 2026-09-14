import { withBranch } from "@/lib/branch-context";
import { Badge, Button, EmptyState, LinkButton, PageHeader, Select } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadConnectAccess, param } from "@/modules/sis/access";
import { listMessages } from "@/modules/connect/broadcasts.service";
import { CHANNEL_LABELS } from "@/modules/connect/delivery-policy";
import type { MessageChannel } from "@/generated/prisma/enums";

const STATUSES = ["QUEUED", "SENT", "DELIVERED", "FAILED"];
const CHANNELS: MessageChannel[] = ["SMS", "EMAIL", "WHATSAPP", "PUSH", "VOICE"];

export default async function DeliveryLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadConnectAccess(param(sp, "branch"), "connect.delivery", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Delivery log" />
        <AccessDenied result={result} permission="connect.delivery:view" />
      </>
    );
  }
  const { ctx } = result.access;
  const statusParam = param(sp, "status") ?? "";
  const channelParam = param(sp, "channel") ?? "";
  const status = STATUSES.includes(statusParam) ? statusParam : undefined;
  const channel = (CHANNELS as string[]).includes(channelParam) ? (channelParam as MessageChannel) : undefined;

  const messages = await listMessages(ctx.organizationId, { status, channel });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Delivery log"
        description={`${messages.length} message${messages.length === 1 ? "" : "s"} shown · every send, including ones triggered automatically`}
        actions={<LinkButton href={withBranch("/connect", ctx)}>← Communication</LinkButton>}
      />

      <form method="get" action="/connect/delivery" className="flex flex-wrap items-end gap-3">
        {ctx.branches.length > 1 ? <input type="hidden" name="branch" value={ctx.branch.id} /> : null}
        <Select name="status" defaultValue={status ?? ""} aria-label="Status" className="w-40">
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.toLowerCase()}
            </option>
          ))}
        </Select>
        <Select name="channel" defaultValue={channel ?? ""} aria-label="Channel" className="w-40">
          <option value="">Any channel</option>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {CHANNEL_LABELS[c]}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      {messages.length === 0 ? (
        <EmptyState>No messages match.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Channel</th>
                <th className="px-3 py-2 font-medium">Recipient</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Body</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {messages.map((m) => (
                <tr key={m.id}>
                  <td className="px-3 py-1.5 font-mono text-xs text-zinc-500">{m.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-300">{CHANNEL_LABELS[m.channel]}</td>
                  <td className="px-3 py-1.5">
                    <span className="text-zinc-900 dark:text-zinc-50">{m.recipientName ?? "—"}</span>{" "}
                    <span className="font-mono text-xs text-zinc-500">{m.recipientAddress}</span>
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge tone={m.status === "SENT" || m.status === "DELIVERED" ? "green" : m.status === "FAILED" ? "red" : "neutral"}>{m.status.toLowerCase()}</Badge>
                    {m.provider ? <span className="ml-1 text-xs text-zinc-400">{m.provider}</span> : null}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">{m.broadcastId ? "Broadcast" : "Automatic"}</td>
                  <td className="px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-300">{m.body}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
