import { recordAuditEvent } from "@/lib/audit";
import { loadHrAccess } from "@/modules/sis/access";
import { getPayrollRun } from "@/modules/hr/payroll.service";
import { periodLabel } from "@/modules/hr/payroll";
import { fromMinor, toMinor } from "@/modules/finance/money";
import { toCsv } from "@/modules/sis/csv";

/**
 * One payroll run as CSV — the file a school hands to its bank or its
 * accountant. Audited: it is a bulk export of everyone's salary, which is
 * the most sensitive pull this product offers.
 *
 * Amounts are written as plain decimals, not formatted currency, so the
 * file imports into a spreadsheet without the ₹ turning a number into text.
 */
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const url = new URL(request.url);
  const result = await loadHrAccess(url.searchParams.get("branch") ?? undefined, "hr.payroll", "export");
  if (!result.ok) return new Response("Forbidden", { status: 403 });
  const { viewer, ctx } = result.access;

  const run = await getPayrollRun(runId, { organizationId: ctx.organizationId, branchId: ctx.branch.id });
  if (!run) return new Response("Not found", { status: 404 });

  // One column per deduction code that actually took money on this run, so
  // an accountant remitting provident fund can total a column rather than
  // reading working notes.
  const codes = [...new Set(run.payslips.flatMap((p) => p.lines.filter((l) => l.kind === "DEDUCTION" && toMinor(l.amount) > 0).map((l) => l.code)))].sort();
  const header = [
    "employee_code",
    "name",
    "email",
    "department",
    "position",
    "days_in_period",
    "payable_days",
    "loss_of_pay_days",
    "gross",
    ...codes.map((c) => `deduction_${c.toLowerCase()}`),
    "deductions",
    "net",
    "employer_contributions",
  ];
  const rows = run.payslips.map((p) => [
    p.staff.employeeCode,
    p.staff.user.name,
    p.staff.user.email,
    p.staff.department?.name ?? "",
    p.staff.position?.title ?? p.staff.designation,
    p.daysInPeriod === null ? "" : String(p.daysInPeriod),
    p.payableDays === null ? "" : String(p.payableDays),
    p.lossOfPayDays === null ? "" : String(p.lossOfPayDays),
    fromMinor(toMinor(p.grossPay)),
    ...codes.map((c) => fromMinor(p.lines.filter((l) => l.kind === "DEDUCTION" && l.code === c).reduce((s, l) => s + toMinor(l.amount), 0))),
    fromMinor(toMinor(p.deductions)),
    fromMinor(toMinor(p.netPay)),
    fromMinor(toMinor(p.employerContributions)),
  ]);
  const netMinor = run.payslips.reduce((s, p) => s + toMinor(p.netPay), 0);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorUserId: viewer.userId,
    action: "payroll_run.exported",
    resourceType: "payroll_run",
    resourceId: runId,
    after: { period: periodLabel(run.periodMonth, run.periodYear), payslips: run.payslips.length, netMinor },
  });

  const tag = `${run.periodYear}-${String(run.periodMonth).padStart(2, "0")}`;
  return new Response(toCsv([header, ...rows]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payroll-${tag}.csv"`,
    },
  });
}
