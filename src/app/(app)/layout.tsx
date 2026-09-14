import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";

/** Flags the nav cares about. Add a key here when a shipped module gets one. */
const NAV_FLAGS = ["phase1.sis"] as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewerContext();
  if (!viewer) redirect("/login");

  const organizationName = viewer.assignments[0]?.organization.name ?? null;

  const enabledFlags = new Set<string>();
  if (viewer.organizationId) {
    const results = await Promise.all(NAV_FLAGS.map((key) => isFeatureEnabled(key, viewer.organizationId)));
    NAV_FLAGS.forEach((key, i) => {
      if (results[i]) enabledFlags.add(key);
    });
  }

  return (
    <Providers>
      <AppShell organizationName={organizationName} userName={viewer.name} enabledFlags={enabledFlags}>
        {children}
      </AppShell>
    </Providers>
  );
}
