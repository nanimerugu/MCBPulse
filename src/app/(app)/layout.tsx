import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { heldPermissionKeys } from "@/lib/rbac";
import { AppShell, NAV_FLAGS } from "@/components/app-shell";
import { Providers } from "@/components/providers";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewerContext();
  if (!viewer) redirect("/login");

  const organizationName = viewer.assignments[0]?.organization.name ?? null;

  // A nav item needs both: the module switched on for the organization, and
  // the viewer actually holding its view permission. Showing a link that
  // only leads to "you don't have permission" is a small lie repeated on
  // every page.
  const [flagResults, permissions] = await Promise.all([
    viewer.organizationId ? Promise.all(NAV_FLAGS.map((key) => isFeatureEnabled(key, viewer.organizationId))) : Promise.resolve([]),
    viewer.organizationId ? heldPermissionKeys(viewer.userId, viewer.organizationId) : Promise.resolve(new Set<string>()),
  ]);

  const enabledFlags = new Set<string>();
  NAV_FLAGS.forEach((key: string, i: number) => {
    if (flagResults[i]) enabledFlags.add(key);
  });

  return (
    <Providers>
      <AppShell organizationName={organizationName} userName={viewer.name} enabledFlags={enabledFlags} permissions={permissions}>
        {children}
      </AppShell>
    </Providers>
  );
}
