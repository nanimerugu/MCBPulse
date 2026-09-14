import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ForgotForm } from "@/app/forgot-password/forgot-form";

export const metadata: Metadata = { title: "Forgot password", robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Forgot your password?" subtitle="We'll email you a link to choose a new one.">
      <ForgotForm />
      <p className="mt-6 text-sm">
        <Link href="/login" className="text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50">
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
