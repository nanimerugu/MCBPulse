import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { inspectLink } from "@/modules/identity/portal-access.service";
import { completeLinkAction } from "@/app/forgot-password/actions";

// A page whose URL is a credential: never indexed, never cached.
export const metadata: Metadata = { title: "Set up your login", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Looking does not use the link up; only choosing a password does.
  const link = await inspectLink(token, "INVITE");

  if (!link.ok) {
    return (
      <AuthCard title="This invitation can't be used">
        <p role="alert" className="text-sm text-zinc-700 dark:text-zinc-200">
          {link.message}
        </p>
        <p className="mt-6 text-sm">
          <Link href="/login" className="text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50">
            Go to sign in
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={`Welcome${link.firstName ? `, ${link.firstName}` : ""}`} subtitle={<>Choose a password for {link.maskedEmail}. You&apos;ll sign in with that email address.</>}>
      <SetPasswordForm action={completeLinkAction.bind(null, token, "INVITE")} submitLabel="Set password" />
    </AuthCard>
  );
}
