"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError } from "@/lib/rbac";
import { actorOf, requireOpsAccessForAction, str, type ModuleAccess } from "@/modules/sis/access";
import type { FormState } from "@/modules/sis/form-state";
import { fieldErrors } from "@/modules/sis/schemas";
import { SisError } from "@/modules/sis/students.service";
import { DEFAULT_LOAN_DAYS } from "@/modules/operations/library";
import {
  createLibraryItem,
  issueLibraryItem,
  returnLibraryItem,
  setTotalCopies,
  type OpsScope,
} from "@/modules/operations/library.service";
import { createInventoryItem, recordStockMovement } from "@/modules/operations/inventory.service";
import { addRouteStop, allocateTransport, createRoute, createVehicle, removeTransport } from "@/modules/operations/transport.service";
import { allocateRoom, checkOutOfRoom, createHostelBlock, createHostelRoom } from "@/modules/operations/hostel.service";
import { checkInVisitor, checkOutVisitor, recordClinicVisit } from "@/modules/operations/campus.service";

function toFormState(error: unknown): FormState {
  if (error instanceof SisError || error instanceof ForbiddenError) return { error: error.message };
  throw error;
}
function values(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
function scopeOf(access: ModuleAccess): OpsScope {
  return { organizationId: access.ctx.organizationId, branchId: access.ctx.branch.id };
}
const optional = (schema: z.ZodTypeAny) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// --- Library -----------------------------------------------------------------

export async function createLibraryItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.library", "create");
    const parsed = z
      .object({
        title: z.string().trim().min(1, "Title is required").max(200),
        author: optional(z.string().trim().max(120)),
        isbn: optional(z.string().trim().max(20)),
        totalCopies: z.coerce.number().int().min(1, "At least one copy").max(9999),
      })
      .safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createLibraryItem(
      {
        title: parsed.data.title,
        author: parsed.data.author as string | undefined,
        isbn: parsed.data.isbn as string | undefined,
        totalCopies: parsed.data.totalCopies,
      },
      scopeOf(access),
      actorOf(access),
    );
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/operations/library");
  return { success: "Title added" };
}

export async function setTotalCopiesAction(itemId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.library", "edit");
    const parsed = z.object({ totalCopies: z.coerce.number().int().min(0).max(9999) }).safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await setTotalCopies(itemId, parsed.data.totalCopies, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/operations/library/${itemId}`);
  revalidatePath("/operations/library");
  return { success: "Copy count updated" };
}

export async function issueLibraryItemAction(itemId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.library", "edit");
    const parsed = z
      .object({
        borrower: z.string().min(1, "Choose a borrower"),
        loanDays: z.coerce.number().int().min(1).max(90).default(DEFAULT_LOAN_DAYS),
      })
      .safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

    // The select carries "student:<id>" / "staff:<id>" so one control covers
    // both kinds of borrower without a second field to keep in sync.
    const [kind, id] = parsed.data.borrower.split(":");
    if ((kind !== "student" && kind !== "staff") || !id) return { error: "That borrower is not valid" };

    await issueLibraryItem(itemId, { kind, id }, { loanDays: parsed.data.loanDays }, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/operations/library/${itemId}`);
  revalidatePath("/operations/library");
  return { success: "Copy issued" };
}

export async function returnLibraryItemAction(issueId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.library", "edit");
    await returnLibraryItem(issueId, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/operations/library");
  return { success: "Copy returned" };
}

// --- Inventory ---------------------------------------------------------------

export async function createInventoryItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.inventory", "create");
    const parsed = z
      .object({
        name: z.string().trim().min(1, "Name is required").max(120),
        sku: z.string().trim().min(1, "SKU is required").max(40),
        unit: z.string().trim().min(1).max(20).default("unit"),
        openingQuantity: z.coerce.number().int().min(0).max(1_000_000),
        reorderLevel: z.coerce.number().int().min(0).max(1_000_000),
      })
      .safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createInventoryItem(parsed.data, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/operations/inventory");
  return { success: "Item added" };
}

export async function recordStockMovementAction(itemId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  let resulting: number;
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.inventory", "edit");
    const parsed = z
      .object({
        kind: z.enum(["RECEIPT", "ISSUE", "WRITE_OFF", "ADJUSTMENT"]),
        quantity: z.coerce.number().int(),
        note: optional(z.string().trim().max(200)),
      })
      .safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    ({ resulting } = await recordStockMovement(
      itemId,
      { kind: parsed.data.kind, quantity: parsed.data.quantity, note: parsed.data.note as string | undefined },
      scopeOf(access),
      actorOf(access),
    ));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/operations/inventory/${itemId}`);
  revalidatePath("/operations/inventory");
  return { success: `Recorded — ${resulting} now in stock` };
}

// --- Transport ---------------------------------------------------------------

export async function createVehicleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.transport", "configure");
    const parsed = z
      .object({
        registrationNumber: z.string().trim().min(1, "Registration is required").max(20),
        capacity: z.coerce.number().int().min(1, "At least one seat").max(200),
        driverStaffId: optional(z.string()),
      })
      .safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createVehicle(
      { registrationNumber: parsed.data.registrationNumber, capacity: parsed.data.capacity, driverStaffId: parsed.data.driverStaffId as string | undefined },
      scopeOf(access),
      actorOf(access),
    );
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/operations/transport");
  return { success: "Vehicle added" };
}

export async function createRouteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.transport", "configure");
    const parsed = z
      .object({ name: z.string().trim().min(1, "Name is required").max(80), vehicleId: optional(z.string()) })
      .safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createRoute({ name: parsed.data.name, vehicleId: parsed.data.vehicleId as string | undefined }, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/operations/transport");
  return { success: "Route added" };
}

export async function addRouteStopAction(routeId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.transport", "configure");
    const parsed = z.object({ name: z.string().trim().min(1, "Stop name is required").max(80) }).safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await addRouteStop(routeId, parsed.data, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/operations/transport");
  return { success: "Stop added" };
}

export async function allocateTransportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.transport", "edit");
    const parsed = z
      .object({
        studentId: z.string().min(1, "Choose a student"),
        routeId: z.string().min(1, "Choose a route"),
        stopId: z.string().min(1, "Choose a stop"),
      })
      .safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await allocateTransport(parsed.data, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/operations/transport");
  return { success: "Student allocated" };
}

export async function removeTransportAction(studentId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.transport", "edit");
    await removeTransport(studentId, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/operations/transport");
  return { success: "Removed from transport" };
}

// --- Hostel ------------------------------------------------------------------

export async function createHostelBlockAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.hostel", "configure");
    const parsed = z.object({ name: z.string().trim().min(1, "Name is required").max(80) }).safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createHostelBlock(parsed.data.name, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/operations/hostel");
  return { success: "Block added" };
}

export async function createHostelRoomAction(blockId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.hostel", "configure");
    const parsed = z
      .object({ roomNumber: z.string().trim().min(1, "Room number is required").max(20), capacity: z.coerce.number().int().min(1, "At least one bed").max(50) })
      .safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await createHostelRoom(blockId, parsed.data, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/operations/hostel");
  return { success: "Room added" };
}

export async function allocateRoomAction(roomId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.hostel", "edit");
    const parsed = z.object({ studentId: z.string().min(1, "Choose a student"), from: isoDate }).safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await allocateRoom({ roomId, studentId: parsed.data.studentId, from: utc(parsed.data.from) }, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/operations/hostel");
  return { success: "Student allocated" };
}

export async function checkOutOfRoomAction(allocationId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.hostel", "edit");
    const parsed = z.object({ to: isoDate }).safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await checkOutOfRoom(allocationId, utc(parsed.data.to), scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/operations/hostel");
  return { success: "Checked out" };
}

// --- Visitors ----------------------------------------------------------------

export async function checkInVisitorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.visitors", "edit");
    const parsed = z
      .object({
        name: z.string().trim().min(1, "Name is required").max(120),
        phone: optional(z.string().trim().max(20)),
        kind: z.enum(["GUARDIAN", "VENDOR", "CONTRACTOR", "OFFICIAL", "ALUMNI", "OTHER"]),
        purpose: z.string().trim().min(1, "Purpose is required").max(200),
        whomToMeet: optional(z.string().trim().max(120)),
        studentId: optional(z.string()),
        passNumber: optional(z.string().trim().max(20)),
      })
      .safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await checkInVisitor(
      {
        name: parsed.data.name,
        phone: parsed.data.phone as string | undefined,
        kind: parsed.data.kind,
        purpose: parsed.data.purpose,
        whomToMeet: parsed.data.whomToMeet as string | undefined,
        studentId: parsed.data.studentId as string | undefined,
        passNumber: parsed.data.passNumber as string | undefined,
      },
      scopeOf(access),
      actorOf(access),
    );
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/operations/visitors");
  revalidatePath("/operations");
  return { success: "Visitor checked in" };
}

export async function checkOutVisitorAction(visitId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.visitors", "edit");
    await checkOutVisitor(visitId, scopeOf(access), actorOf(access));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/operations/visitors");
  revalidatePath("/operations");
  return { success: "Visitor checked out" };
}

// --- Infirmary ---------------------------------------------------------------

export async function recordClinicVisitAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let notified = 0;
  let unreached: string | null = null;
  try {
    const access = await requireOpsAccessForAction(str(formData, "branchId"), "ops.infirmary", "edit");
    const parsed = z
      .object({
        studentId: z.string().min(1, "Choose a student"),
        complaint: z.string().trim().min(1, "Describe the complaint").max(500),
        treatment: optional(z.string().trim().max(500)),
        outcome: z.enum(["RETURNED_TO_CLASS", "OBSERVATION", "SENT_HOME", "REFERRED_TO_HOSPITAL"]),
        temperatureCelsius: optional(z.coerce.number().min(30, "30–45 °C").max(45, "30–45 °C")),
        notifyGuardians: optional(z.string()),
      })
      .safeParse(values(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

    const result = await recordClinicVisit(
      {
        studentId: parsed.data.studentId,
        complaint: parsed.data.complaint,
        treatment: parsed.data.treatment as string | undefined,
        outcome: parsed.data.outcome,
        temperatureCelsius: parsed.data.temperatureCelsius as number | undefined,
        notifyGuardians: parsed.data.notifyGuardians === "on",
      },
      { ...scopeOf(access), branchName: access.ctx.branch.name },
      actorOf(access),
    );
    notified = result.notified.queued;
    unreached = result.unreached;
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/operations/infirmary");
  // Both banners render. The visit genuinely was saved, and the fact that
  // nobody was reached is the part the person at the desk has to act on.
  return {
    success: notified > 0 ? `Visit recorded — ${notified} guardian message${notified === 1 ? "" : "s"} sent` : "Visit recorded",
    ...(unreached ? { error: unreached } : {}),
  };
}
