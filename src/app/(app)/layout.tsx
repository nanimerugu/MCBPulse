import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/tenant";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewerContext();
  if (!viewer) redirect("/login");

  const organizationName = viewer.assignments[0]?.organization.name ?? null;

  return (
    <Providers>
      <AppShell organizationName={organizationName} userName={viewer.name}>
        {children}
      </AppShell>
    </Providers>
  );
}
