import "server-only";
import { db } from "@/lib/db";
import { isValidTimeZone } from "@/lib/time-zone";
import type { QuietHours } from "@/modules/connect/delivery-policy";

export interface QuietHoursSetting {
  quiet: QuietHours | null;
  /** The clock the window is read on. */
  timeZone: string;
}

/**
 * An organization's quiet hours and the clock to read them on.
 *
 * The window is set once per organization, but the clock belongs to a
 * branch: a group with a campus in another zone must not have that campus
 * texted at the wrong hour. So callers that know which branch they are
 * sending for pass it, and the rest fall back to the organization's first
 * branch. There used to be two private copies of this lookup, both reading
 * the window in UTC.
 */
export async function quietHoursFor(organizationId: string, branchId?: string | null): Promise<QuietHoursSetting> {
  const [org, branch] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { quietHoursStart: true, quietHoursEnd: true } }),
    branchId
      ? db.branch.findFirst({ where: { id: branchId, organizationId }, select: { timezone: true } })
      : db.branch.findFirst({ where: { organizationId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { timezone: true } }),
  ]);
  const timeZone = branch?.timezone && isValidTimeZone(branch.timezone) ? branch.timezone : "UTC";
  const quiet = org?.quietHoursStart && org?.quietHoursEnd ? { start: org.quietHoursStart, end: org.quietHoursEnd } : null;
  return { quiet, timeZone };
}

/** A branch's clock, for showing times back to the people who work there. */
export async function branchTimeZone(branchId: string): Promise<string> {
  const branch = await db.branch.findUnique({ where: { id: branchId }, select: { timezone: true } });
  return branch?.timezone && isValidTimeZone(branch.timezone) ? branch.timezone : "UTC";
}
