import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/tenant";
import { landingPathFor } from "@/modules/portal/landing";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "./login-form";

/** Fixed messages only — a `?notice=` value is looked up, never echoed. */
const NOTICES: Record<string, string> = {
  welcome: "Your password is set. Sign in with it now.",
  reset: "Password changed. Anywhere that was signed in with the old password has been signed out.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // getViewerContext, not auth(): a cookie for a user who no longer exists
  // must land here and see the form, not bounce back to the app.
  const viewer = await getViewerContext();
  if (viewer) redirect(await landingPathFor(viewer.userId));

  const sp = await searchParams;
  const key = typeof sp.notice === "string" ? sp.notice : "";
  const notice = Object.hasOwn(NOTICES, key) ? NOTICES[key] : undefined;

  return (
    <AuthCard title="Sign in" subtitle="School Operating System">
      {notice ? (
        <p role="status" className="mb-4 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          {notice}
        </p>
      ) : null}
      <LoginForm />
      <p className="mt-6 text-sm">
        <Link href="/forgot-password" className="text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50">
          Forgot your password?
        </Link>
      </p>
    </AuthCard>
  );
}
