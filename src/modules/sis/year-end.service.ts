import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import type { YearOutcome } from "@/generated/prisma/enums";
import {
  checkNewYearDates,
  checkPlan,
  suggestPlan,
  summarizePlan,
  type Decision,
  type DecisionInput,
  type NextYearSection,
  type PlanStudent,
} from "@/modules/sis/promotion";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * The academic year's end: open the next year, plan every student's move,
 * and commit it all at once.
 *
 * Before this, an academic year could only exist because the seed made one.
 * "Current year" is read by attendance, timetables, cover, the LMS, imports
 * and invoices, so switching it is the single most far-reaching thing an
 * administrator can do — which is why it happens in exactly one place, in
 * one transaction, together with every student's placement.
 */

export interface YearScope {
  organizationId: string;
  branchId: string;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const OUTCOME: Record<Decision, YearOutcome> = { PROMOTE: "PROMOTED", RETAIN: "RETAINED", GRADUATE: "GRADUATED", UNPLACED: "UNPLACED" };

export async function listYears(scope: YearScope) {
  return db.academicYear.findMany({
    where: { branchId: scope.branchId, deletedAt: null, branch: { organizationId: scope.organizationId } },
    include: { _count: { select: { sections: { where: { deletedAt: null } }, studentOutcomes: true } } },
    orderBy: { startDate: "asc" },
  });
}

export async function createNextYear(input: { name: string; startISO: string; endISO: string; copySections: boolean }, scope: YearScope, actor: Actor) {
  const branch = await db.branch.findFirst({ where: { id: scope.branchId, organizationId: scope.organizationId, deletedAt: null } });
  if (!branch) throw new SisError("Branch not found");
  const name = input.name.trim();
  if (name.length === 0 || name.length > 40) throw new SisError("Name the year, e.g. 2027-2028");

  const years = await db.academicYear.findMany({ where: { branchId: scope.branchId, deletedAt: null } });
  if (years.some((y) => y.name.toLowerCase() === name.toLowerCase())) throw new SisError(`${name} already exists`);
  const dateProblem = checkNewYearDates({
    startISO: input.startISO,
    endISO: input.endISO,
    existing: years.map((y) => ({ name: y.name, startISO: isoDate(y.startDate), endISO: isoDate(y.endDate) })),
  });
  if (dateProblem) throw new SisError(dateProblem);

  const current = years.find((y) => y.isCurrent);
  // Read OUTSIDE the transaction — see the pooled-connection note in memory:
  // the transaction below only ever talks to its own connection.
  const toCopy = input.copySections && current ? await db.section.findMany({ where: { academicYearId: current.id, deletedAt: null, grade: { deletedAt: null } } }) : [];

  const year = await db.$transaction(async (tx) => {
    const created = await tx.academicYear.create({
      data: { branchId: scope.branchId, name, startDate: new Date(`${input.startISO}T00:00:00.000Z`), endDate: new Date(`${input.endISO}T00:00:00.000Z`), isCurrent: false },
    });
    if (toCopy.length > 0) {
      await tx.section.createMany({ data: toCopy.map((s) => ({ gradeId: s.gradeId, academicYearId: created.id, name: s.name, capacity: s.capacity })) });
    }
    return created;
  });

  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "academic_year.created",
    resourceType: "academic_year",
    resourceId: year.id,
    after: { name, start: input.startISO, end: input.endISO, sectionsCopied: toCopy.length, copiedFrom: current?.name ?? null },
  });
  return { year, sectionsCopied: toCopy.length };
}

/** For a next year created without sections: copy this year's in. */
export async function copySectionsIntoYear(yearId: string, scope: YearScope, actor: Actor) {
  const [target, current] = await Promise.all([
    db.academicYear.findFirst({ where: { id: yearId, branchId: scope.branchId, deletedAt: null, isCurrent: false, isClosed: false }, include: { _count: { select: { sections: true } } } }),
    db.academicYear.findFirst({ where: { branchId: scope.branchId, isCurrent: true, deletedAt: null } }),
  ]);
  if (!target) throw new SisError("That year can't take sections — it's current, closed or missing");
  if (!current) throw new SisError("There is no current year to copy sections from");
  if (target._count.sections > 0) throw new SisError(`${target.name} already has sections`);

  const sections = await db.section.findMany({ where: { academicYearId: current.id, deletedAt: null, grade: { deletedAt: null } } });
  await db.section.createMany({ data: sections.map((s) => ({ gradeId: s.gradeId, academicYearId: target.id, name: s.name, capacity: s.capacity })) });
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "academic_year.sections_copied",
    resourceType: "academic_year",
    resourceId: target.id,
    after: { from: current.name, to: target.name, sections: sections.length },
  });
  return sections.length;
}

export async function getPromotionPlan(scope: YearScope) {
  const current = await db.academicYear.findFirst({ where: { branchId: scope.branchId, isCurrent: true, isClosed: false, deletedAt: null, branch: { organizationId: scope.organizationId } } });
  if (!current) return { current: null, next: null, students: [], sectionOf: new Map<string, string>(), nextSections: [], gradeSequences: [], rows: [] };

  const next = await db.academicYear.findFirst({
    where: { branchId: scope.branchId, isCurrent: false, isClosed: false, deletedAt: null, startDate: { gt: current.startDate } },
    orderBy: { startDate: "asc" },
  });

  const [enrolled, nextSectionRows, grades] = await Promise.all([
    db.student.findMany({
      where: { organizationId: scope.organizationId, branchId: scope.branchId, status: "ENROLLED", deletedAt: null, currentSection: { academicYearId: current.id, deletedAt: null } },
      include: { currentSection: { include: { grade: true } } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
    next ? db.section.findMany({ where: { academicYearId: next.id, deletedAt: null, grade: { deletedAt: null } }, include: { grade: true } }) : Promise.resolve([]),
    db.grade.findMany({ where: { branchId: scope.branchId, deletedAt: null }, select: { sequence: true } }),
  ]);

  const students: PlanStudent[] = enrolled.map((s) => ({
    studentId: s.id,
    name: `${s.firstName} ${s.lastName}`.trim(),
    admissionNumber: s.admissionNumber,
    gradeId: s.currentSection!.gradeId,
    gradeName: s.currentSection!.grade.name,
    gradeSequence: s.currentSection!.grade.sequence,
    sectionName: s.currentSection!.name,
  }));
  const sectionOf = new Map(enrolled.map((s) => [s.id, s.currentSectionId!]));
  const nextSections: NextYearSection[] = nextSectionRows
    .map((s) => ({ id: s.id, gradeId: s.gradeId, gradeName: s.grade.name, gradeSequence: s.grade.sequence, name: s.name, capacity: s.capacity }))
    .sort((a, b) => a.gradeSequence - b.gradeSequence || a.name.localeCompare(b.name));
  const gradeSequences = grades.map((g) => g.sequence);

  return { current, next, students, sectionOf, nextSections, gradeSequences, rows: next ? suggestPlan(students, nextSections, gradeSequences) : [] };
}

export interface YearEndSummary {
  from: string;
  to: string;
  counts: Record<Decision, number>;
}

/**
 * Close the current year and open the next, placing every student.
 *
 * All or nothing. The year switch, every outcome row and every placement
 * share one transaction, and it begins with a conditional update that only
 * succeeds on a year still open and current — so two administrators pressing
 * the button together get one year-end, not two, and a failure part-way
 * leaves last year exactly as it was.
 */
export async function commitYearEnd(decisions: DecisionInput[], scope: YearScope, actor: Actor): Promise<YearEndSummary> {
  const plan = await getPromotionPlan(scope);
  if (!plan.current) throw new SisError("There is no open current year to close");
  if (!plan.next) throw new SisError("Create next year first");

  const check = checkPlan(plan.students, decisions, plan.nextSections, plan.gradeSequences);
  if (!check.ok) throw new SisError(check.problems.join(" · "));

  const current = plan.current;
  const next = plan.next;
  const byStudent = new Map(decisions.map((d) => [d.studentId, d]));
  const placements = new Map<string, string[]>();
  const graduates: string[] = [];
  const unplaced: string[] = [];
  for (const s of plan.students) {
    const d = byStudent.get(s.studentId)!;
    if (d.decision === "GRADUATE") graduates.push(s.studentId);
    else if (d.decision === "UNPLACED") unplaced.push(s.studentId);
    else placements.set(d.targetSectionId!, [...(placements.get(d.targetSectionId!) ?? []), s.studentId]);
  }

  await db.$transaction(
    async (tx) => {
      const closed = await tx.academicYear.updateMany({ where: { id: current.id, isCurrent: true, isClosed: false }, data: { isCurrent: false, isClosed: true } });
      if (closed.count === 0) throw new SisError(`${current.name} has already been closed — reload the page`);
      await tx.academicYear.update({ where: { id: next.id }, data: { isCurrent: true } });

      await tx.studentYearOutcome.createMany({
        data: plan.students.map((s) => {
          const d = byStudent.get(s.studentId)!;
          return {
            studentId: s.studentId,
            academicYearId: current.id,
            outcome: OUTCOME[d.decision],
            fromSectionId: plan.sectionOf.get(s.studentId) ?? null,
            toSectionId: d.targetSectionId,
            decidedByUserId: actor.userId,
          };
        }),
      });

      for (const [sectionId, ids] of placements) {
        await tx.student.updateMany({ where: { id: { in: ids }, status: "ENROLLED" }, data: { currentSectionId: sectionId } });
      }
      if (graduates.length > 0) await tx.student.updateMany({ where: { id: { in: graduates } }, data: { status: "ALUMNI", currentSectionId: null } });
      if (unplaced.length > 0) await tx.student.updateMany({ where: { id: { in: unplaced } }, data: { currentSectionId: null } });
    },
    { timeout: 30_000 },
  );

  const counts = summarizePlan(decisions);
  await recordAuditEvent({
    organizationId: scope.organizationId,
    actorUserId: actor.userId,
    action: "year_end.committed",
    resourceType: "academic_year",
    resourceId: current.id,
    after: { from: current.name, to: next.name, ...counts },
  });

  // One line on each Student 360 timeline. After the commit and best-effort:
  // the outcome rows are the record; these are the readable trail.
  const nextName = new Map(plan.nextSections.map((s) => [s.id, `${s.gradeName} / ${s.name}`]));
  for (const s of plan.students) {
    const d = byStudent.get(s.studentId)!;
    await recordAuditEvent({
      organizationId: scope.organizationId,
      actorUserId: actor.userId,
      action: "student.year_end",
      resourceType: "student",
      resourceId: s.studentId,
      before: { year: current.name, section: `${s.gradeName} / ${s.sectionName}` },
      after: { year: next.name, outcome: OUTCOME[d.decision], section: d.targetSectionId ? nextName.get(d.targetSectionId) : null },
    }).catch((e) => console.error("[year-end] timeline event failed", e));
  }

  return { from: current.name, to: next.name, counts };
}
