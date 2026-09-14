import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { checkAdmits } from "@/modules/operations/capacity";
import { SisError, type Actor } from "@/modules/sis/students.service";
import type { OpsScope } from "@/modules/operations/library.service";

/**
 * Hostel (blueprint Phase 8). Blocks hold rooms, rooms hold beds, a student
 * occupies one bed for a span of time.
 *
 * An allocation is CURRENT while `allocatedTo` is null. Checking a student
 * out sets that date rather than deleting the row: who slept where last term
 * is exactly the question a school gets asked after an incident.
 */

export async function listHostelBlocks(scope: OpsScope) {
  return db.hostelBlock.findMany({
    where: { branchId: scope.branchId, deletedAt: null },
    include: {
      rooms: {
        orderBy: { roomNumber: "asc" },
        include: {
          allocations: {
            where: { allocatedTo: null },
            include: { student: { include: { currentSection: { include: { grade: true } } } } },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function getHostelRoom(roomId: string, scope: OpsScope) {
  return db.hostelRoom.findFirst({
    where: { id: roomId, hostelBlock: { branchId: scope.branchId, deletedAt: null } },
    include: {
      hostelBlock: true,
      allocations: {
        include: { student: { include: { currentSection: { include: { grade: true } } } } },
        orderBy: [{ allocatedTo: "asc" }, { allocatedFrom: "desc" }],
      },
    },
  });
}

export async function createHostelBlock(name: string, scope: OpsScope, actor: Actor) {
  const clash = await db.hostelBlock.findFirst({ where: { branchId: scope.branchId, name, deletedAt: null } });
  if (clash) throw new SisError(`A block called "${name}" already exists`);

  const block = await db.hostelBlock.create({ data: { branchId: scope.branchId, name } });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "hostel_block.created",
    resourceType: "hostel_block",
    resourceId: block.id,
    after: { name },
  });
  return block;
}

export async function createHostelRoom(blockId: string, input: { roomNumber: string; capacity: number }, scope: OpsScope, actor: Actor) {
  if (!Number.isInteger(input.capacity) || input.capacity < 1) throw new SisError("A room needs at least one bed");

  const block = await db.hostelBlock.findFirst({ where: { id: blockId, branchId: scope.branchId, deletedAt: null } });
  if (!block) throw new SisError("Block not found");

  const clash = await db.hostelRoom.findFirst({ where: { hostelBlockId: blockId, roomNumber: input.roomNumber } });
  if (clash) throw new SisError(`Room ${input.roomNumber} already exists in ${block.name}`);

  const room = await db.hostelRoom.create({ data: { hostelBlockId: blockId, roomNumber: input.roomNumber, capacity: input.capacity } });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "hostel_room.created",
    resourceType: "hostel_room",
    resourceId: room.id,
    after: { block: block.name, roomNumber: input.roomNumber, capacity: input.capacity },
  });
  return room;
}

export async function allocateRoom(input: { roomId: string; studentId: string; from: Date }, scope: OpsScope, actor: Actor) {
  const room = await db.hostelRoom.findFirst({
    where: { id: input.roomId, hostelBlock: { branchId: scope.branchId, deletedAt: null } },
    include: { hostelBlock: true },
  });
  if (!room) throw new SisError("Room not found");

  const student = await db.student.findFirst({
    where: { id: input.studentId, organizationId: scope.organizationId, deletedAt: null },
  });
  if (!student) throw new SisError("Student not found");

  // One bed at a time, anywhere on campus — not just in this room.
  const existing = await db.hostelAllocation.findFirst({
    where: { studentId: input.studentId, allocatedTo: null },
    include: { hostelRoom: { include: { hostelBlock: true } } },
  });
  if (existing) {
    throw new SisError(
      `${student.firstName} is already in ${existing.hostelRoom.hostelBlock.name} room ${existing.hostelRoom.roomNumber} — check them out first`,
    );
  }

  const occupied = await db.hostelAllocation.count({ where: { hostelRoomId: input.roomId, allocatedTo: null } });
  const check = checkAdmits({ capacity: room.capacity, occupied }, `${room.hostelBlock.name} room ${room.roomNumber}`);
  if (!check.ok) throw new SisError(check.message);

  const allocation = await db.hostelAllocation.create({
    data: { hostelRoomId: input.roomId, studentId: input.studentId, allocatedFrom: input.from },
  });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "hostel.allocated",
    resourceType: "student",
    resourceId: input.studentId,
    after: {
      allocationId: allocation.id,
      block: room.hostelBlock.name,
      room: room.roomNumber,
      from: input.from.toISOString().slice(0, 10),
    },
  });
  return allocation;
}

export async function checkOutOfRoom(allocationId: string, to: Date, scope: OpsScope, actor: Actor) {
  const allocation = await db.hostelAllocation.findFirst({
    where: { id: allocationId, hostelRoom: { hostelBlock: { branchId: scope.branchId } } },
    include: { hostelRoom: { include: { hostelBlock: true } }, student: true },
  });
  if (!allocation) throw new SisError("Allocation not found");
  if (allocation.allocatedTo) throw new SisError("This student has already been checked out");
  if (to.getTime() < allocation.allocatedFrom.getTime()) throw new SisError("The check-out date is before the check-in date");

  await db.hostelAllocation.update({ where: { id: allocationId }, data: { allocatedTo: to } });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "hostel.checked_out",
    resourceType: "student",
    resourceId: allocation.studentId,
    after: {
      allocationId,
      block: allocation.hostelRoom.hostelBlock.name,
      room: allocation.hostelRoom.roomNumber,
      to: to.toISOString().slice(0, 10),
    },
  });
}
