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

  const header = ["employee_code", "name", "email", "department", "position", "gross", "deductions", "net"];
  const rows = run.payslips.map((p) => [
    p.staff.employeeCode,
    p.staff.user.name,
    p.staff.user.email,
    p.staff.department?.name ?? "",
    p.staff.position?.title ?? p.staff.designation,
    fromMinor(toMinor(p.grossPay)),
    fromMinor(toMinor(p.deductions)),
    fromMinor(toMinor(p.netPay)),
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
