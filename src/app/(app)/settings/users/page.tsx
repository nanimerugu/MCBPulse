import { getViewerContext } from "@/lib/tenant";
import { authorize } from "@/lib/rbac";
import { db } from "@/lib/db";

export default async function UsersSettingsPage() {
  const viewer = await getViewerContext();
  if (!viewer) return null;

  if (!viewer.organizationId) {
    return <EmptyState message="You have no organization to view users for." />;
  }

  const canView = await authorize(viewer.userId, "identity.users", "view", {
    organizationId: viewer.organizationId,
  });
  if (!canView) {
    return <EmptyState message="You don't have permission to view users in this organization (identity.users:view)." />;
  }

  const assignments = await db.roleAssignment.findMany({
    where: { organizationId: viewer.organizationId, revokedAt: null },
    include: { user: true, role: true, branch: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Users &amp; roles</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Every active role assignment in this organization. This page itself is gated by{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">identity.users:view</code> — the
          RBAC check you&apos;re seeing pass to read it.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Scope</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {assignments.map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-2 text-zinc-900 dark:text-zinc-50">{a.user.name}</td>
                <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{a.user.email}</td>
                <td className="px-4 py-2 text-zinc-900 dark:text-zinc-50">{a.role.name}</td>
                <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{a.branch?.name ?? "All branches"}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={a.user.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    INVITED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    DISABLED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? styles.DISABLED}`}>
      {status}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="max-w-3xl rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
      {message}
    </div>
  );
}
