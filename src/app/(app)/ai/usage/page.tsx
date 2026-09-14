import { withBranch } from "@/lib/branch-context";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadAiAccess, param } from "@/modules/sis/access";
import { listGenerations, usageByCapability } from "@/modules/ai/gateway.service";
import { CAPABILITY_BY_KEY } from "@/modules/ai/capabilities";
import { formatDate } from "@/modules/sis/labels";

export default async function AiUsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadAiAccess(param(sp, "branch"), "ai.usage", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="AI usage" />
        <AccessDenied result={result} permission="ai.usage:view" />
      </>
    );
  }
  const { ctx } = result.access;
  const [byCapability, generations] = await Promise.all([usageByCapability(ctx.organizationId), listGenerations(ctx.organizationId)]);

  const totalTokens = byCapability.reduce((s, r) => s + r.tokensIn + r.tokensOut, 0);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="AI usage"
        description={`${generations.length} recorded request${generations.length === 1 ? "" : "s"} · ${totalTokens.toLocaleString()} estimated tokens`}
        actions={<LinkButton href={withBranch("/ai", ctx)}>Back to assistant</LinkButton>}
      />

      <Card title="By capability">
        {byCapability.length === 0 ? (
          <EmptyState>Nothing has been run yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <tr>
                  <th className="py-2 pr-4 font-medium">Capability</th>
                  <th className="py-2 pr-4 text-right font-medium">Runs</th>
                  <th className="py-2 pr-4 text-right font-medium">Failed</th>
                  <th className="py-2 pr-4 text-right font-medium">Tokens in</th>
                  <th className="py-2 text-right font-medium">Tokens out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {byCapability.map((r) => (
                  <tr key={r.capability}>
                    <td className="py-2 pr-4">{CAPABILITY_BY_KEY.get(r.capability)?.name ?? r.capability}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{r.runs}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{r.failed || "—"}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{r.tokensIn.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums">{r.tokensOut.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Token counts are estimates from the recording adapter (roughly four characters per token). They exist so the cost of switching a
          real provider on is knowable before it is switched on, not after the first invoice.
        </p>
      </Card>

      <Card title="Every request">
        {generations.length === 0 ? (
          <EmptyState>No AI requests recorded.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {generations.map((g) => {
              const usage = g.usageRecords[0];
              return (
                <li key={g.id} className="py-2.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {CAPABILITY_BY_KEY.get(g.capability)?.name ?? g.capability}
                      <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">{g.user.name}</span>
                    </span>
                    <span className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {usage ? `${usage.provider}/${usage.model} · ${usage.tokensIn + usage.tokensOut} tok` : "no usage recorded"} ·{" "}
                      {formatDate(g.createdAt)}
                      <Badge tone={g.status === "COMPLETED" ? "green" : g.status === "FAILED" ? "red" : "neutral"}>{g.status.toLowerCase()}</Badge>
                    </span>
                  </div>
                  {g.inputSummary ? <p className="mt-0.5 truncate text-zinc-500 dark:text-zinc-400">{g.inputSummary}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Summaries only. The audit log records that a request happened, by whom, against which capability and at what cost — it is not a
          second copy of whatever was pasted in.
        </p>
      </Card>
    </div>
  );
}
