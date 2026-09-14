import "server-only";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { fromMinor, toMinor } from "@/modules/finance/money";
import { checkRule, type DeductionRule } from "@/modules/hr/deductions";
import { SisError, type Actor } from "@/modules/sis/students.service";

/**
 * Payroll deduction rules, basic pay and per-person declared amounts.
 *
 * Every rate here is typed in by the school. The service validates SHAPE
 * (a percentage rule has a percentage; a fixed rule has an amount) and never
 * the numbers themselves — whether provident fund is 12% is a legal question
 * this software is not placed to answer.
 */

const minor = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : toMinor(d));

type RuleRow = Awaited<ReturnType<typeof db.payrollDeductionRule.findMany>>[number];

/** Database row → the pure rule the payslip arithmetic uses. */
export function toRule(r: RuleRow): DeductionRule {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    basis: r.basis,
    employeePercent: r.employeePercent === null ? null : Number(r.employeePercent),
    employerPercent: r.employerPercent === null ? null : Number(r.employerPercent),
    fixedMinor: minor(r.fixedAmount),
    wageCeilingMinor: minor(r.wageCeiling),
    grossEligibilityMaxMinor: minor(r.grossEligibilityMax),
  };
}

export async function listDeductionRules(organizationId: string, opts: { activeOnly?: boolean } = {}) {
  return db.payrollDeductionRule.findMany({
    where: { organizationId, ...(opts.activeOnly ? { active: true } : {}) },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
}

export async function createDeductionRule(input: Omit<DeductionRule, "id">, actor: Actor) {
  const code = input.code.trim().toUpperCase();
  const candidate = { ...input, code, name: input.name.trim() };
  const check = checkRule(candidate);
  if (!check.ok) throw new SisError(check.message);
  if (await db.payrollDeductionRule.findUnique({ where: { organizationId_code: { organizationId: actor.organizationId, code } } })) {
    throw new SisError(`A rule with code ${code} already exists`);
  }

  const rule = await db.payrollDeductionRule.create({
    data: {
      organizationId: actor.organizationId,
      code,
      name: candidate.name,
      basis: candidate.basis,
      employeePercent: candidate.employeePercent === null ? null : candidate.employeePercent.toFixed(2),
      employerPercent: candidate.employerPercent === null ? null : candidate.employerPercent.toFixed(2),
      fixedAmount: candidate.fixedMinor === null ? null : fromMinor(candidate.fixedMinor),
      wageCeiling: candidate.wageCeilingMinor === null ? null : fromMinor(candidate.wageCeilingMinor),
      grossEligibilityMax: candidate.grossEligibilityMaxMinor === null ? null : fromMinor(candidate.grossEligibilityMaxMinor),
      createdByUserId: actor.userId,
    },
  });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "payroll_rule.created",
    resourceType: "payroll_rule",
    resourceId: rule.id,
    after: { ...candidate },
  });
  return rule;
}

/**
 * Rules are switched off, never edited or deleted: a payslip already
 * generated names the rule it applied, and changing a rate should be a new
 * rule with its own history, not a quiet rewrite of the old one.
 */
export async function setDeductionRuleActive(ruleId: string, active: boolean, actor: Actor) {
  const rule = await db.payrollDeductionRule.findFirst({ where: { id: ruleId, organizationId: actor.organizationId } });
  if (!rule) throw new SisError("Rule not found");
  if (rule.active === active) return;
  await db.payrollDeductionRule.update({ where: { id: ruleId }, data: { active } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: active ? "payroll_rule.activated" : "payroll_rule.deactivated",
    resourceType: "payroll_rule",
    resourceId: ruleId,
    after: { code: rule.code },
  });
}

export async function setMonthlyBasicPay(staffId: string, basicMinor: number | null, actor: Actor) {
  const staff = await db.staff.findFirst({ where: { id: staffId, organizationId: actor.organizationId, deletedAt: null } });
  if (!staff) throw new SisError("Staff member not found");
  if (basicMinor !== null && basicMinor < 0) throw new SisError("Basic pay can't be negative");
  if (basicMinor !== null && staff.monthlyGrossPay !== null && basicMinor > toMinor(staff.monthlyGrossPay)) {
    throw new SisError("Basic pay can't be more than monthly gross pay");
  }
  const before = minor(staff.monthlyBasicPay);
  await db.staff.update({ where: { id: staffId }, data: { monthlyBasicPay: basicMinor === null ? null : fromMinor(basicMinor) } });
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "staff.basic_pay_changed",
    resourceType: "staff",
    resourceId: staffId,
    before: { monthlyBasicPayMinor: before },
    after: { monthlyBasicPayMinor: basicMinor },
  });
}

export async function listDeclaredForStaff(staffId: string, organizationId: string) {
  return db.staffDeclaredDeduction.findMany({ where: { staffId, staff: { organizationId } }, include: { rule: true } });
}

/** A DECLARED rule's monthly amount for one person. Null clears it. */
export async function setDeclaredDeduction(input: { staffId: string; ruleId: string; monthlyMinor: number | null; note?: string }, actor: Actor) {
  const [staff, rule] = await Promise.all([
    db.staff.findFirst({ where: { id: input.staffId, organizationId: actor.organizationId, deletedAt: null } }),
    db.payrollDeductionRule.findFirst({ where: { id: input.ruleId, organizationId: actor.organizationId } }),
  ]);
  if (!staff) throw new SisError("Staff member not found");
  if (!rule) throw new SisError("Rule not found");
  if (rule.basis !== "DECLARED") throw new SisError(`${rule.code} isn't a declared-amount rule`);
  if (input.monthlyMinor !== null && input.monthlyMinor < 0) throw new SisError("The amount can't be negative");

  if (input.monthlyMinor === null) {
    await db.staffDeclaredDeduction.deleteMany({ where: { staffId: staff.id, ruleId: rule.id } });
  } else {
    await db.staffDeclaredDeduction.upsert({
      where: { staffId_ruleId: { staffId: staff.id, ruleId: rule.id } },
      create: { staffId: staff.id, ruleId: rule.id, monthlyAmount: fromMinor(input.monthlyMinor), note: input.note ?? null, updatedByUserId: actor.userId },
      update: { monthlyAmount: fromMinor(input.monthlyMinor), note: input.note ?? null, updatedByUserId: actor.userId },
    });
  }
  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "staff.declared_deduction_set",
    resourceType: "staff",
    resourceId: staff.id,
    after: { rule: rule.code, monthlyMinor: input.monthlyMinor, note: input.note ?? null },
  });
}

/** Declared amounts for a set of staff: staffId → (ruleId → minor units). */
export async function declaredByStaff(staffIds: string[]): Promise<Map<string, Map<string, number>>> {
  const rows = staffIds.length === 0 ? [] : await db.staffDeclaredDeduction.findMany({ where: { staffId: { in: staffIds } } });
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = out.get(r.staffId) ?? new Map<string, number>();
    m.set(r.ruleId, toMinor(r.monthlyAmount));
    out.set(r.staffId, m);
  }
  return out;
}
