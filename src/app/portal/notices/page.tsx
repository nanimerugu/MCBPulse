import { Card, EmptyState } from "@/components/ui";
import { ChildSwitcher } from "@/components/portal/child-switcher";
import { PortalDenied } from "@/components/portal/denial";
import { loadPortalPage } from "@/modules/portal/page-shell";
import { getAnnouncements } from "@/modules/portal/portal.service";
import { CHANNEL_LABELS } from "@/modules/connect/delivery-policy";
import { param } from "@/modules/sis/access";

export default async function PortalNotices({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const page = await loadPortalPage(param(sp, "child"));
  if (!page.ok) return <PortalDenied result={page.result} />;
  const { scope, studentId, children } = page;

  const notices = await getAnnouncements(studentId, scope.organizationId);

  return (
    <div className="mx-auto max-w-2xl">
      <ChildSwitcher scope={scope} students={children} activeId={studentId} basePath="/portal/notices" />
      <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Notices</h1>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">What the school has actually sent your family.</p>

      {notices.length === 0 ? (
        <EmptyState>Nothing has been sent yet.</EmptyState>
      ) : (
        <Card title={`${notices.length} message${notices.length === 1 ? "" : "s"}`}>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {notices.map((n) => (
              <li key={n.id} className="py-3 text-sm">
                <p className="text-zinc-700 dark:text-zinc-300">{n.body}</p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {CHANNEL_LABELS[n.channel]} · {n.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-600">
        This list is the school&apos;s own delivery log, so it cannot disagree with what was sent.
      </p>
    </div>
  );
}
