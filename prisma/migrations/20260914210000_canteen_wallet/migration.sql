-- CreateEnum
CREATE TYPE "CanteenTransactionKind" AS ENUM ('TOP_UP', 'PURCHASE', 'REFUND', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "CanteenAccount" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanteenAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanteenTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "saleId" TEXT,
    "kind" "CanteenTransactionKind" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanteenTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanteenSale" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "soldByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanteenSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanteenSaleLine" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "canteenItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "CanteenSaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CanteenAccount_studentId_key" ON "CanteenAccount"("studentId");

-- CreateIndex
CREATE INDEX "CanteenTransaction_accountId_createdAt_idx" ON "CanteenTransaction"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "CanteenSale_accountId_createdAt_idx" ON "CanteenSale"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CanteenItem_branchId_name_key" ON "CanteenItem"("branchId", "name");

-- AddForeignKey
ALTER TABLE "CanteenAccount" ADD CONSTRAINT "CanteenAccount_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanteenTransaction" ADD CONSTRAINT "CanteenTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CanteenAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanteenTransaction" ADD CONSTRAINT "CanteenTransaction_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "CanteenSale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanteenSale" ADD CONSTRAINT "CanteenSale_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CanteenAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanteenSaleLine" ADD CONSTRAINT "CanteenSaleLine_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "CanteenSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanteenSaleLine" ADD CONSTRAINT "CanteenSaleLine_canteenItemId_fkey" FOREIGN KEY ("canteenItemId") REFERENCES "CanteenItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
