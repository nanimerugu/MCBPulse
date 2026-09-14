import Link from "next/link";
import type { PortalScopeResult } from "@/modules/portal/scope";
import { portalDenialMessage } from "@/modules/portal/page-shell";

/** Every portal refusal says which of the three things went wrong, and what fixes it. */
export function PortalDenied({ result }: { result: PortalScopeResult }) {
  const { title, body } = portalDenialMessage(result);
  const staff = !result.ok && result.reason === "not_a_portal_user";
  return (
    <div className="mx-auto max-w-md rounded-lg border border-zinc-200 p-6 text-center dark:border-zinc-800">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{body}</p>
      {staff ? (
        <Link
          href="/dashboard"
          className="mt-4 inline-block rounded-md bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Go to the dashboard
        </Link>
      ) : null}
    </div>
  );
}
