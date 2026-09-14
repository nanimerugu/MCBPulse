import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { fromMinor, toMinor } from "@/modules/finance/money";
import { SisError, type Actor } from "@/modules/sis/students.service";

// --- Fee heads (organization-wide catalog) -------------------------------------

export async function listFeeHeads(organizationId: string) {
  return db.feeHead.findMany({ where: { organizationId, deletedAt: null }, orderBy: { name: "asc" } });
}

export async function createFeeHead(name: string, actor: Actor) {
  const clash = await db.feeHead.findUnique({ where: { organizationId_name: { organizationId: actor.organizationId, name } } });
  if (clash) throw new SisError(`Fee head "${name}" already exists`);
  const head = await db.feeHead.create({ data: { organizationId: actor.organizationId, name } });
  await recordAuditEvent({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "fee_head.created", resourceType: "fee_head", resourceId: head.id, after: { name } });
  return head;
}

// --- Fee structures (per branch + academic year, optionally per grade) ---------

export async function listFeeStructures(branchId: string, academicYearId: string) {
  const structures = await db.feeStructure.findMany({
    where: { branchId, academicYearId, deletedAt: null },
    include: { grade: true, lines: { include: { feeHead: true }, orderBy: { feeHead: { name: "asc" } } }, _count: { select: { invoices: true } } },
    orderBy: [{ grade: { sequence: "asc" } }, { name: "asc" }],
  });
  return structures.map((s) => ({ ...s, totalMinor: s.lines.reduce((sum, l) => sum + toMinor(l.amount), 0) }));
}

export async function createFeeStructure(
  input: { name: string; gradeId?: string },
  scope: { branchId: string; academicYearId: string },
  actor: Actor,
) {
  if (input.gradeId) {
    const grade = await db.grade.findFirst({ where: { id: input.gradeId, branchId: scope.branchId, deletedAt: null } });
    if (!grade) throw new SisError("Grade not found in this branch");
  }
  const structure = await db.feeStructure.create({
    data: { branchId: scope.branchId, academicYearId: scope.academicYearId, gradeId: input.gradeId ?? null, name: input.name },
    include: { grade: true, academicYear: true },
  });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "fee_structure.created",
    resourceType: "fee_structure",
    resourceId: structure.id,
    after: { name: structure.name, grade: structure.grade?.name ?? null, academicYear: structure.academicYear.name },
  });
  return structure;
}

export async function addFeeStructureLine(structureId: string, input: { feeHeadId: string; amountMinor: number }, actor: Actor) {
  const structure = await db.feeStructure.findFirst({
    where: { id: structureId, deletedAt: null, branch: { organizationId: actor.organizationId } },
    include: { _count: { select: { invoices: true } } },
  });
  if (!structure) throw new SisError("Fee structure not found");
  if (structure._count.invoices > 0) throw new SisError("This structure already has invoices raised from it — create a new structure instead of changing this one");
  const head = await db.feeHead.findFirst({ where: { id: input.feeHeadId, organizationId: actor.organizationId, deletedAt: null } });
  if (!head) throw new SisError("Fee head not found");

  const line = await db.feeStructureLine.upsert({
    where: { feeStructureId_feeHeadId: { feeStructureId: structureId, feeHeadId: input.feeHeadId } },
    create: { feeStructureId: structureId, feeHeadId: input.feeHeadId, amount: fromMinor(input.amountMinor) },
    update: { amount: fromMinor(input.amountMinor) },
  });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "fee_structure.line_set",
    resourceType: "fee_structure",
    resourceId: structureId,
    after: { feeHead: head.name, amount: fromMinor(input.amountMinor) },
  });
  return line;
}

export async function removeFeeStructureLine(lineId: string, actor: Actor) {
  const line = await db.feeStructureLine.findFirst({
    where: { id: lineId, feeStructure: { branch: { organizationId: actor.organizationId } } },
    include: { feeHead: true, feeStructure: { include: { _count: { select: { invoices: true } } } } },
  });
  if (!line) throw new SisError("Line not found");
  if (line.feeStructure._count.invoices > 0) throw new SisError("This structure already has invoices raised from it");
  await db.feeStructureLine.delete({ where: { id: lineId } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "fee_structure.line_removed",
    resourceType: "fee_structure",
    resourceId: line.feeStructureId,
    before: { feeHead: line.feeHead.name, amount: line.amount.toString() },
  });
}

// --- Concessions --------------------------------------------------------------

export async function listConcessions(studentId: string, organizationId: string) {
  return db.concession.findMany({
    where: { studentId, student: { organizationId } },
    include: { feeStructure: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

/** Granting is a single approved step (the grantor needs finance.concessions:approve). */
export async function grantConcession(studentId: string, input: { amountMinor: number; reason: string; feeStructureId?: string }, actor: Actor) {
  const student = await db.student.findFirst({ where: { id: studentId, organizationId: actor.organizationId, deletedAt: null } });
  if (!student) throw new SisError("Student not found");
  if (input.feeStructureId) {
    const s = await db.feeStructure.findFirst({ where: { id: input.feeStructureId, branch: { organizationId: actor.organizationId }, deletedAt: null } });
    if (!s) throw new SisError("Fee structure not found");
  }
  const concession = await db.concession.create({
    data: { studentId, feeStructureId: input.feeStructureId ?? null, amount: fromMinor(input.amountMinor), reason: input.reason, approvedByUserId: actor.userId },
  });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "concession.granted",
    resourceType: "student",
    resourceId: studentId,
    after: { amount: fromMinor(input.amountMinor), reason: input.reason, feeStructureId: input.feeStructureId ?? null },
  });
  return concession;
}
