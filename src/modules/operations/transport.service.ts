import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { checkAdmits } from "@/modules/operations/capacity";
import { SisError, type Actor } from "@/modules/sis/students.service";
import type { OpsScope } from "@/modules/operations/library.service";

/**
 * Transport (blueprint Phase 8). A vehicle has seats, a route runs on a
 * vehicle, students board at a stop on a route. The capacity that matters is
 * the VEHICLE's, counted across every route it serves — one bus doing a
 * morning and an afternoon route still has one set of seats, and counting
 * per-route would quietly let a school allocate twice the seats it has.
 */

export async function listVehicles(scope: OpsScope) {
  return db.vehicle.findMany({
    where: { organizationId: scope.organizationId, branchId: scope.branchId, deletedAt: null },
    include: {
      driverStaff: { include: { user: true } },
      routes: { where: { deletedAt: null }, include: { _count: { select: { studentTransports: true } } } },
    },
    orderBy: { registrationNumber: "asc" },
  });
}

export async function listRoutes(scope: OpsScope) {
  return db.route.findMany({
    where: { branchId: scope.branchId, deletedAt: null },
    include: {
      vehicle: true,
      stops: { orderBy: { sequence: "asc" } },
      _count: { select: { studentTransports: true } },
    },
    orderBy: { name: "asc" },
  });
}

/** Seats taken on a vehicle: every student on every route it serves. */
export async function vehicleOccupancy(vehicleId: string): Promise<number> {
  return db.studentTransport.count({ where: { route: { vehicleId, deletedAt: null } } });
}

export async function createVehicle(
  input: { registrationNumber: string; capacity: number; driverStaffId?: string },
  scope: OpsScope,
  actor: Actor,
) {
  if (!Number.isInteger(input.capacity) || input.capacity < 1) throw new SisError("Capacity must be at least one seat");

  const clash = await db.vehicle.findFirst({
    where: { organizationId: scope.organizationId, registrationNumber: input.registrationNumber, deletedAt: null },
  });
  if (clash) throw new SisError(`Vehicle ${input.registrationNumber} already exists`);

  if (input.driverStaffId) {
    const driver = await db.staff.findFirst({
      where: { id: input.driverStaffId, organizationId: scope.organizationId, deletedAt: null, exitDate: null },
    });
    if (!driver) throw new SisError("Driver not found, or has left the school");
  }

  const vehicle = await db.vehicle.create({
    data: {
      organizationId: scope.organizationId,
      branchId: scope.branchId,
      registrationNumber: input.registrationNumber,
      capacity: input.capacity,
      driverStaffId: input.driverStaffId ?? null,
    },
  });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "vehicle.created",
    resourceType: "vehicle",
    resourceId: vehicle.id,
    after: { registrationNumber: input.registrationNumber, capacity: input.capacity },
  });
  return vehicle;
}

export async function createRoute(input: { name: string; vehicleId?: string }, scope: OpsScope, actor: Actor) {
  if (input.vehicleId) {
    const vehicle = await db.vehicle.findFirst({ where: { id: input.vehicleId, branchId: scope.branchId, deletedAt: null } });
    if (!vehicle) throw new SisError("Vehicle not found");
  }
  const route = await db.route.create({ data: { branchId: scope.branchId, name: input.name, vehicleId: input.vehicleId ?? null } });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "route.created",
    resourceType: "route",
    resourceId: route.id,
    after: { name: input.name, vehicleId: input.vehicleId ?? null },
  });
  return route;
}

export async function addRouteStop(routeId: string, input: { name: string }, scope: OpsScope, actor: Actor) {
  const route = await db.route.findFirst({ where: { id: routeId, branchId: scope.branchId, deletedAt: null } });
  if (!route) throw new SisError("Route not found");

  // Sequence is assigned, not typed in: it's an ordering, and asking a user
  // to keep it unique by hand only produces collisions on the unique index.
  const last = await db.routeStop.findFirst({ where: { routeId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
  const stop = await db.routeStop.create({ data: { routeId, name: input.name, sequence: (last?.sequence ?? 0) + 1 } });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "route_stop.created",
    resourceType: "route",
    resourceId: routeId,
    after: { stopId: stop.id, name: input.name, sequence: stop.sequence },
  });
  return stop;
}

/**
 * Put a student on a route. `StudentTransport.studentId` is unique, so a
 * student has at most one allocation and re-allocating replaces it — the
 * upsert is the whole "transfer between routes" story.
 */
export async function allocateTransport(
  input: { studentId: string; routeId: string; stopId: string },
  scope: OpsScope,
  actor: Actor,
) {
  const student = await db.student.findFirst({
    where: { id: input.studentId, organizationId: scope.organizationId, deletedAt: null },
  });
  if (!student) throw new SisError("Student not found");

  const route = await db.route.findFirst({
    where: { id: input.routeId, branchId: scope.branchId, deletedAt: null },
    include: { vehicle: true },
  });
  if (!route) throw new SisError("Route not found");

  const stop = await db.routeStop.findFirst({ where: { id: input.stopId, routeId: input.routeId } });
  if (!stop) throw new SisError("That stop is not on this route");

  const existing = await db.studentTransport.findUnique({ where: { studentId: input.studentId } });

  if (route.vehicle) {
    const occupied = await vehicleOccupancy(route.vehicle.id);
    // Moving a student between two routes on the SAME vehicle frees the seat
    // they are about to take, so it must not count against them.
    const movingWithinSameVehicle =
      existing !== null &&
      (await db.route.findUnique({ where: { id: existing.routeId }, select: { vehicleId: true } }))?.vehicleId === route.vehicle.id;

    const check = checkAdmits(
      { capacity: route.vehicle.capacity, occupied: movingWithinSameVehicle ? occupied - 1 : occupied },
      `Vehicle ${route.vehicle.registrationNumber}`,
    );
    if (!check.ok) throw new SisError(check.message);
  }

  const allocation = await db.studentTransport.upsert({
    where: { studentId: input.studentId },
    create: { studentId: input.studentId, routeId: input.routeId, stopId: input.stopId },
    update: { routeId: input.routeId, stopId: input.stopId },
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: existing ? "transport.reallocated" : "transport.allocated",
    resourceType: "student",
    resourceId: input.studentId,
    before: existing ? { routeId: existing.routeId, stopId: existing.stopId } : undefined,
    after: { routeId: input.routeId, stopId: input.stopId, route: route.name, stop: stop.name },
  });
  return allocation;
}

export async function removeTransport(studentId: string, scope: OpsScope, actor: Actor) {
  const existing = await db.studentTransport.findFirst({
    where: { studentId, student: { organizationId: scope.organizationId } },
  });
  if (!existing) throw new SisError("This student is not on a route");

  await db.studentTransport.delete({ where: { studentId } });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "transport.removed",
    resourceType: "student",
    resourceId: studentId,
    before: { routeId: existing.routeId, stopId: existing.stopId },
  });
}

export async function listTransportAllocations(scope: OpsScope) {
  return db.studentTransport.findMany({
    where: { student: { organizationId: scope.organizationId, deletedAt: null }, route: { branchId: scope.branchId } },
    include: { student: { include: { currentSection: { include: { grade: true } } } }, route: { include: { vehicle: true } }, stop: true },
    orderBy: [{ route: { name: "asc" } }, { stop: { sequence: "asc" } }],
    take: 200,
  });
}
