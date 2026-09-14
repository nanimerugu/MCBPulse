-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "convertedStudentId" TEXT,
ADD COLUMN     "decidedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "FeeStructure" ADD COLUMN     "gradeId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "feeStructureId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "nextFollowUpAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Application_convertedStudentId_key" ON "Application"("convertedStudentId");

-- AddForeignKey
ALTER TABLE "FeeStructure" ADD CONSTRAINT "FeeStructure_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_feeStructureId_fkey" FOREIGN KEY ("feeStructureId") REFERENCES "FeeStructure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
