import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { inspectLink } from "@/modules/identity/portal-access.service";
import { completeLinkAction } from "@/app/forgot-password/actions";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await inspectLink(token, "PASSWORD_RESET");

  if (!link.ok) {
    return (
      <AuthCard title="This link can't be used">
        <p role="alert" className="text-sm text-zinc-700 dark:text-zinc-200">
          {link.message}
        </p>
        <p className="mt-6 flex flex-col gap-2 text-sm">
          <Link href="/forgot-password" className="text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50">
            Ask for a new link
          </Link>
          <Link href="/login" className="text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50">
            Go to sign in
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choose a new password"
      subtitle={<>For {link.maskedEmail}. Anywhere you&apos;re still signed in with the old password will be signed out.</>}
    >
      <SetPasswordForm action={completeLinkAction.bind(null, token, "PASSWORD_RESET")} submitLabel="Change password" />
    </AuthCard>
  );
}
