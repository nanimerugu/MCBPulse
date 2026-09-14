import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { heldPermissionKeys } from "@/lib/rbac";
import { AppShell, NAV_FLAGS } from "@/components/app-shell";
import { landingPathFor } from "@/modules/portal/landing";
import { Providers } from "@/components/providers";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewerContext();
  if (!viewer) redirect("/login");

  // A parent or student who reaches any staff route — by bookmark, by typing
  // it, or by following an old link — is sent to the portal rather than shown
  // a shell of modules that all refuse them. Done here rather than in the
  // login action so every entry path is covered, not just the form.
  if ((await landingPathFor(viewer.userId)) === "/portal") redirect("/portal");

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
