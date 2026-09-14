"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { ForbiddenError } from "@/lib/rbac";
import type { FormState } from "@/modules/sis/form-state";
import { fieldErrors } from "@/modules/sis/schemas";
import { SisError } from "@/modules/sis/students.service";
import { getStaffSelf } from "@/modules/hr/self";
import { findClash, toUtcDate, validateLeaveRange } from "@/modules/hr/leave";

function toFormState(error: unknown): FormState {
  if (error instanceof SisError || error instanceof ForbiddenError) return { error: error.message };
  throw error;
}

const schema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an end date"),
  reason: z.string().trim().min(1, "Give a reason").max(500),
});

/**
 * File leave for yourself.
 *
 * The security property is what this action DOESN'T take: there is no
 * staffId parameter, no hidden field, nothing from the form that names a
 * person. The staff id comes from the signed-in user's own record, so there
 * is no input to tamper with — a request on a colleague's behalf is not
 * refused, it is unexpressible.
 */
export async function requestOwnLeaveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const result = await getStaffSelf();
    if (!result.ok) return { error: "Your login isn't linked to an active staff record" };
    const { self } = result;

    const values: Record<string, string> = {};
    for (const [k, v] of formData.entries()) if (typeof v === "string") values[k] = v;
    const parsed = schema.safeParse(values);
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

    const range = { fromDate: toUtcDate(parsed.data.fromDate), toDate: toUtcDate(parsed.data.toDate) };
    const valid = validateLeaveRange(range);
    if (!valid.ok) return { error: valid.message };

    // Same clash rule as the HR-administered path, reusing the same helper.
    const existing = await db.leaveRequest.findMany({
      where: { staffId: self.staffId, status: { in: ["PENDING", "APPROVED"] } },
      select: { id: true, fromDate: true, toDate: true, status: true },
    });
    const clash = findClash(range, existing);
    if (clash) {
      const from = clash.fromDate.toISOString().slice(0, 10);
      const to = clash.toDate.toISOString().slice(0, 10);
      return { error: `That overlaps your existing ${clash.status.toLowerCase()} request (${from} to ${to})` };
    }

    const leave = await db.leaveRequest.create({ data: { staffId: self.staffId, ...range, reason: parsed.data.reason } });

    await recordAuditEvent({
      organizationId: self.organizationId,
      actorUserId: self.viewer.userId,
      action: "staff_leave.requested_self",
      resourceType: "staff",
      resourceId: self.staffId,
      after: { leaveId: leave.id, from: parsed.data.fromDate, to: parsed.data.toDate, reason: parsed.data.reason },
    });
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/my/leave");
  revalidatePath("/hr/leave");
  return { success: "Request sent — HR will decide on it" };
}
