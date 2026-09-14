import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">MCBPulse</p>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Sign in</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">School Operating System — Phase 0</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
