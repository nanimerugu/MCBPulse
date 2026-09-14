-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('RECEIPT', 'ISSUE', 'WRITE_OFF', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "VisitorKind" AS ENUM ('GUARDIAN', 'VENDOR', 'CONTRACTOR', 'OFFICIAL', 'ALUMNI', 'OTHER');

-- CreateEnum
CREATE TYPE "ClinicOutcome" AS ENUM ('RETURNED_TO_CLASS', 'SENT_HOME', 'REFERRED_TO_HOSPITAL', 'OBSERVATION');

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "unit" TEXT NOT NULL DEFAULT 'unit';

-- AlterTable
ALTER TABLE "LibraryIssue" ADD COLUMN     "issuedByUserId" TEXT,
ADD COLUMN     "returnedByUserId" TEXT,
ADD COLUMN     "staffId" TEXT;

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "kind" "StockMovementKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "quantityAfter" INTEGER NOT NULL,
    "note" TEXT,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorLog" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "kind" "VisitorKind" NOT NULL DEFAULT 'OTHER',
    "purpose" TEXT NOT NULL,
    "whomToMeet" TEXT,
    "studentId" TEXT,
    "passNumber" TEXT,
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkOutAt" TIMESTAMP(3),
    "checkedInByUserId" TEXT NOT NULL,
    "checkedOutByUserId" TEXT,

    CONSTRAINT "VisitorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicVisit" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "complaint" TEXT NOT NULL,
    "treatment" TEXT,
    "outcome" "ClinicOutcome" NOT NULL DEFAULT 'RETURNED_TO_CLASS',
    "temperatureCelsius" DECIMAL(4,1),
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guardianNotifiedAt" TIMESTAMP(3),
    "recordedByUserId" TEXT NOT NULL,

    CONSTRAINT "ClinicVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockMovement_inventoryItemId_createdAt_idx" ON "StockMovement"("inventoryItemId", "createdAt");

-- CreateIndex
CREATE INDEX "VisitorLog_branchId_checkOutAt_idx" ON "VisitorLog"("branchId", "checkOutAt");

-- CreateIndex
CREATE INDEX "VisitorLog_branchId_checkInAt_idx" ON "VisitorLog"("branchId", "checkInAt");

-- CreateIndex
CREATE INDEX "ClinicVisit_branchId_visitedAt_idx" ON "ClinicVisit"("branchId", "visitedAt");

-- CreateIndex
CREATE INDEX "ClinicVisit_studentId_visitedAt_idx" ON "ClinicVisit"("studentId", "visitedAt");

-- CreateIndex
CREATE INDEX "LibraryIssue_libraryItemId_returnedAt_idx" ON "LibraryIssue"("libraryItemId", "returnedAt");

-- CreateIndex
CREATE INDEX "LibraryIssue_studentId_returnedAt_idx" ON "LibraryIssue"("studentId", "returnedAt");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryIssue" ADD CONSTRAINT "LibraryIssue_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorLog" ADD CONSTRAINT "VisitorLog_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorLog" ADD CONSTRAINT "VisitorLog_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicVisit" ADD CONSTRAINT "ClinicVisit_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicVisit" ADD CONSTRAINT "ClinicVisit_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
