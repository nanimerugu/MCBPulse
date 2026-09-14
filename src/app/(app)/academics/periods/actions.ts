"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, authorize } from "@/lib/rbac";
import { localDateISO } from "@/lib/time-zone";
import { actorOf, requireAcademicsAccessForAction, str } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { SisError } from "@/modules/sis/students.service";
import { isAttendanceStatus } from "@/modules/academics/attendance-summary";
import type { RegisterMark } from "@/modules/academics/attendance.service";
import { getStaffForViewer } from "@/modules/academics/scope";
import { savePeriodRegister } from "@/modules/academics/period-attendance.service";
import { branchTimeZone } from "@/modules/connect/quiet-hours";

export async function savePeriodRegisterAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const slotId = str(formData, "slotId") ?? "";
  const dateISO = str(formData, "date") ?? "";
  try {
    const access = await requireAcademicsAccessForAction(str(formData, "branchId"), "academics.attendance", "create");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return { error: "Bad date" };

    const marks: RegisterMark[] = [];
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("status:") || typeof value !== "string" || !isAttendanceStatus(value)) continue;
      const studentId = key.slice("status:".length);
      const versionRaw = str(formData, `version:${studentId}`);
      marks.push({ studentId, status: value, remarks: str(formData, `remarks:${studentId}`), version: versionRaw ? Number(versionRaw) : undefined });
    }

    const tenant = { organizationId: access.ctx.organizationId, branchId: access.ctx.branch.id };
    const [staff, canApprove, tz] = await Promise.all([
      getStaffForViewer(access.viewer.userId, access.ctx.organizationId),
      authorize(access.viewer.userId, "academics.attendance", "approve", tenant),
      branchTimeZone(access.ctx.branch.id),
    ]);
    const result = await savePeriodRegister(
      slotId,
      dateISO,
      marks,
      {
        viewerStaffId: staff?.id ?? null,
        // A section-scoped grant (a teacher) must be the lesson's teacher; a
        // school-wide grant (an administrator) may take any lesson's register.
        unscopedTaker: !access.decision.sectionScoped,
        canApprove,
        // "Today" on the campus clock, not the server's.
        todayISO: localDateISO(new Date(), tz),
      },
      tenant,
      actorOf(access),
    );
    revalidatePath("/academics/periods");
    return { success: result.created ? "Lesson register saved" : result.changed ? `Corrected ${result.changed} mark${result.changed === 1 ? "" : "s"}` : "No changes" };
  } catch (e) {
    if (e instanceof SisError || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
}
