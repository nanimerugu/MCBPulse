-- CreateEnum
CREATE TYPE "AutomationActionKind" AS ENUM ('NOTIFY_GUARDIANS', 'NOTIFY_USER');

-- CreateEnum
CREATE TYPE "AutomationRunOutcome" AS ENUM ('MATCHED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "eventKind" TEXT NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "action" "AutomationActionKind" NOT NULL,
    "messageBody" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "outcome" "AutomationRunOutcome" NOT NULL,
    "facts" JSONB NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRule_organizationId_eventKind_active_idx" ON "AutomationRule"("organizationId", "eventKind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRule_organizationId_name_key" ON "AutomationRule"("organizationId", "name");

-- CreateIndex
CREATE INDEX "AutomationRun_ruleId_createdAt_idx" ON "AutomationRun"("ruleId", "createdAt");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
