import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { db } from "@/lib/db";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadConnectAccess, param } from "@/modules/sis/access";
import { hasDeliveringProvider } from "@/modules/connect/providers";
import { CHANNEL_LABELS } from "@/modules/connect/delivery-policy";
import { formatDate } from "@/modules/sis/labels";

export default async function ConnectIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadConnectAccess(param(sp, "branch"), "connect.broadcasts", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Communication" />
        <AccessDenied result={result} permission="connect.broadcasts:view" />
      </>
    );
  }
  const { ctx } = result.access;

  const [recent, counts] = await Promise.all([
    db.broadcast.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "desc" }, take: 5, include: { _count: { select: { messages: true } } } }),
    db.message.groupBy({ by: ["status"], where: { organizationId: ctx.organizationId }, _count: { _all: true } }),
  ]);
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));

  const cards = [
    { href: "/connect/broadcasts", title: "Broadcasts", description: "Write a notice, pick who gets it, see exactly who would receive it before sending." },
    { href: "/connect/templates", title: "Templates", description: "Reusable message bodies with a fixed, safe set of variables." },
    { href: "/connect/delivery", title: "Delivery log", description: "Every message, its recipient, its status and what was actually sent." },
    { href: "/connect/settings", title: "Quiet hours & consent", description: "When the school may contact families, and who has opted out." },
  ];

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Communication" description={`${ctx.branch.name} · ${(byStatus.SENT ?? 0) + (byStatus.QUEUED ?? 0) + (byStatus.FAILED ?? 0)} messages recorded`} />

      {!hasDeliveringProvider() ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <p className="font-medium text-amber-900 dark:text-amber-200">No delivery provider is configured</p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            Messages are <strong>recorded, not delivered</strong> — the audience, consent, quiet-hours and rendering pipeline all run, and every message is
            written to the delivery log marked <code className="text-xs">recorded</code>, but nothing reaches a phone or inbox. Plug a real SMS/email adapter
            into <code className="text-xs">src/modules/connect/providers.ts</code> to change that.
          </p>
        </div>
      ) : null}

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <li key={c.href}>
            <Link href={withBranch(c.href, ctx)} className="block h-full rounded-lg border border-zinc-200 p-4 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
              <p className="font-medium text-zinc-900 dark:text-zinc-50">{c.title}</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{c.description}</p>
            </Link>
          </li>
        ))}
      </ul>

      <Card title="Recent broadcasts">
        {recent.length === 0 ? (
          <EmptyState>Nothing sent yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {recent.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <Link href={withBranch(`/connect/broadcasts/${b.id}`, ctx)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                  {b.subject || b.body.slice(0, 48)}
                </Link>
                <span className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                  {CHANNEL_LABELS[b.channel]} · {b._count.messages} message{b._count.messages === 1 ? "" : "s"} · {formatDate(b.createdAt)}
                  <Badge tone={b.status === "SENT" ? "green" : b.status === "FAILED" ? "red" : b.status === "SCHEDULED" ? "amber" : "neutral"}>{b.status.toLowerCase()}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
