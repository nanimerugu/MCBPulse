-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "deductionDescription" TEXT,
ADD COLUMN     "deductionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "fixedDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "paidAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "exitReason" TEXT,
ADD COLUMN     "monthlyGrossPay" DECIMAL(12,2);

-- CreateIndex
CREATE UNIQUE INDEX "Position_organizationId_title_key" ON "Position"("organizationId", "title");
