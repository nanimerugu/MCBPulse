-- CreateEnum
CREATE TYPE "LibraryFineStatus" AS ENUM ('PENDING', 'CHARGED', 'WAIVED');

-- AlterTable
ALTER TABLE "HostelBlock" ADD COLUMN     "monthlyFee" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "sourceKey" TEXT;

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "LibraryIssue" ADD COLUMN     "fineAmount" DECIMAL(12,2),
ADD COLUMN     "fineDecidedByUserId" TEXT,
ADD COLUMN     "fineInvoiceId" TEXT,
ADD COLUMN     "fineNote" TEXT,
ADD COLUMN     "fineStatus" "LibraryFineStatus";

-- AlterTable
ALTER TABLE "Route" ADD COLUMN     "monthlyFee" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "BranchBillingPolicy" (
    "branchId" TEXT NOT NULL,
    "libraryFinePerDay" DECIMAL(12,2),
    "libraryFineCap" DECIMAL(12,2),
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchBillingPolicy_pkey" PRIMARY KEY ("branchId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_organizationId_sourceKey_key" ON "Invoice"("organizationId", "sourceKey");

-- AddForeignKey
ALTER TABLE "BranchBillingPolicy" ADD CONSTRAINT "BranchBillingPolicy_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
