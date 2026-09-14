-- CreateEnum
CREATE TYPE "DeductionBasis" AS ENUM ('PERCENT_OF_BASIC', 'PERCENT_OF_GROSS', 'FIXED', 'DECLARED');

-- CreateEnum
CREATE TYPE "PayslipLineKind" AS ENUM ('EARNING', 'LOSS_OF_PAY', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION');

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "unpaid" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "daysInPeriod" INTEGER,
ADD COLUMN     "employerContributions" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "lossOfPayDays" INTEGER,
ADD COLUMN     "payableDays" INTEGER;

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "monthlyBasicPay" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "PayrollDeductionRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "basis" "DeductionBasis" NOT NULL,
    "employeePercent" DECIMAL(5,2),
    "employerPercent" DECIMAL(5,2),
    "fixedAmount" DECIMAL(12,2),
    "wageCeiling" DECIMAL(12,2),
    "grossEligibilityMax" DECIMAL(12,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollDeductionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffDeclaredDeduction" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "monthlyAmount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "updatedByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffDeclaredDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayslipLine" (
    "id" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "kind" "PayslipLineKind" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "detail" TEXT,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "PayslipLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollDeductionRule_organizationId_code_key" ON "PayrollDeductionRule"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "StaffDeclaredDeduction_staffId_ruleId_key" ON "StaffDeclaredDeduction"("staffId", "ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "PayslipLine_payslipId_sequence_key" ON "PayslipLine"("payslipId", "sequence");

-- AddForeignKey
ALTER TABLE "PayrollDeductionRule" ADD CONSTRAINT "PayrollDeductionRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDeclaredDeduction" ADD CONSTRAINT "StaffDeclaredDeduction_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDeclaredDeduction" ADD CONSTRAINT "StaffDeclaredDeduction_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "PayrollDeductionRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipLine" ADD CONSTRAINT "PayslipLine_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
