import "server-only";
import { db } from "@/lib/db";

/**
 * Resolves a flag for one organization: an org-specific override wins,
 * otherwise the flag's global default, otherwise false for a flag that was
 * never seeded at all (fail closed rather than throw).
 */
export async function isFeatureEnabled(key: string, organizationId: string | null): Promise<boolean> {
  const flag = await db.featureFlag.findUnique({ where: { key } });
  if (!flag) return false;
  if (!organizationId) return flag.defaultEnabled;

  const override = await db.featureFlagOverride.findUnique({
    where: { flagKey_organizationId: { flagKey: key, organizationId } },
  });
  return override?.enabled ?? flag.defaultEnabled;
}

export async function setFeatureFlagOverride(key: string, organizationId: string, enabled: boolean) {
  await db.featureFlagOverride.upsert({
    where: { flagKey_organizationId: { flagKey: key, organizationId } },
    create: { flagKey: key, organizationId, enabled },
    update: { enabled },
  });
}
