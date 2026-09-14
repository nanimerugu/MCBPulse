import Link from "next/link";
import { withBranch } from "@/lib/branch-context";
import { db } from "@/lib/db";
import { heldPermissionKeys } from "@/lib/rbac";
import { Badge, Card, EmptyState, Field, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { AccessDenied } from "@/components/sis/access-denied";
import { loadAiAccess, param } from "@/modules/sis/access";
import { CAPABILITIES, UNBUILT_CAPABILITIES } from "@/modules/ai/capabilities";
import { hasGeneratingProvider } from "@/modules/ai/providers";
import { formatDate } from "@/modules/sis/labels";
import { runCapabilityAction } from "@/app/(app)/ai/actions";

export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await loadAiAccess(param(sp, "branch"), "ai.console", "view");
  if (!result.ok) {
    return (
      <>
        <PageHeader title="AI assistant" />
        <AccessDenied result={result} permission="ai.console:view" />
      </>
    );
  }
  const { ctx, viewer } = result.access;
  const [held, recent] = await Promise.all([
    heldPermissionKeys(viewer.userId, ctx.organizationId),
    db.aiGeneration.findMany({
      where: { organizationId: ctx.organizationId, userId: viewer.userId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  // Only offer what this person could actually run — a capability whose
  // underlying permission they lack would only fail at the gateway.
  const available = CAPABILITIES.filter((c) => held.has(`${c.requires.module}:${c.requires.action}`));
  const hidden = { branchId: ctx.branch.id };
  const latest = recent[0];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="AI assistant"
        description="Every request is checked against the permissions you already hold, redacted, logged and costed."
        actions={held.has("ai.usage:view") ? <LinkButton href={withBranch("/ai/usage", ctx)}>Usage</LinkButton> : undefined}
      />

      {!hasGeneratingProvider() ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <p className="font-medium text-amber-900 dark:text-amber-200">No AI provider is configured</p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            Nothing is generated. The whole pipeline still runs — your permission is checked, identifiers are redacted, school data is
            fenced as untrusted, and the attempt is recorded with a token estimate — so switching a model on is a one-file change in{" "}
            <code className="text-xs">src/modules/ai/providers.ts</code>.
          </p>
        </div>
      ) : null}

      {available.length === 0 ? (
        <EmptyState>
          You can open this page, but none of the AI capabilities match permissions you hold. Each one requires the same permission as the
          records it touches.
        </EmptyState>
      ) : (
        <Card title="Ask for something">
          <ActionForm action={runCapabilityAction} hidden={hidden} submitLabel="Run" pendingLabel="Working…">
            <Field label="What do you want" htmlFor="ai-cap">
              <Select id="ai-cap" name="capability" defaultValue={available[0]?.key}>
                {available.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name} — {c.description}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Details" htmlFor="ai-task" hint="Be specific. Don't paste anything you wouldn't want a third party to hold.">
              <Textarea id="ai-task" name="task" rows={5} required maxLength={8000} placeholder="A 40-minute lesson on equivalent fractions for Grade 5" />
            </Field>
          </ActionForm>

          <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">What each one sends</p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {available.map((c) => (
                <li key={c.key} className="text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">{c.name}:</span> {c.dataNote}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {latest?.outputSummary ? (
        <Card title="Latest result">
          <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-800 dark:text-zinc-200">{latest.outputSummary}</pre>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            {latest.capability.toLowerCase().replace(/_/g, " ")} · {formatDate(latest.createdAt)} · a draft for you to accept, change or
            reject — nothing here has been saved to a student&apos;s record.
          </p>
        </Card>
      ) : null}

      {recent.length > 1 ? (
        <Card title="Your recent requests">
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {recent.slice(1).map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="truncate text-zinc-700 dark:text-zinc-300">{g.inputSummary ?? "—"}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  {formatDate(g.createdAt)}
                  <Badge tone={g.status === "COMPLETED" ? "green" : g.status === "FAILED" ? "red" : "neutral"}>{g.status.toLowerCase()}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title="Not built, and why">
        <ul className="flex flex-col gap-2">
          {UNBUILT_CAPABILITIES.map((c) => (
            <li key={c.name} className="text-sm">
              <span className="font-medium text-zinc-900 dark:text-zinc-50">{c.name}</span>
              <span className="text-zinc-500 dark:text-zinc-400"> — {c.reason}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          The gateway also cannot write. Every capability returns text for a person to accept or reject; none of them mark a register,
          change a grade or send a message.{" "}
          <Link href={withBranch("/settings", ctx)} className="underline">
            Feature flags
          </Link>{" "}
          switch the whole module off per organization.
        </p>
      </Card>
    </div>
  );
}
