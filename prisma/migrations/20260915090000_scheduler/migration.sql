-- CreateEnum
CREATE TYPE "JobTrigger" AS ENUM ('SCHEDULE', 'MANUAL');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "AutomationRule" ADD COLUMN     "offsetDays" INTEGER;

-- AlterTable
ALTER TABLE "AutomationRun" ADD COLUMN     "dedupeKey" TEXT;

-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN     "branchId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "notBefore" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "trigger" "JobTrigger" NOT NULL,
    "organizationId" TEXT,
    "triggeredByUserId" TEXT,
    "status" "JobRunStatus" NOT NULL DEFAULT 'RUNNING',
    "summary" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLease" (
    "jobKey" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "leasedUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLease_pkey" PRIMARY KEY ("jobKey")
);

-- CreateIndex
CREATE INDEX "JobRun_jobKey_organizationId_startedAt_idx" ON "JobRun"("jobKey", "organizationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRun_dedupeKey_key" ON "AutomationRun"("dedupeKey");

-- CreateIndex
CREATE INDEX "Message_status_notBefore_idx" ON "Message"("status", "notBefore");

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: a broadcast created before this migration has no branch. Give it
-- its organization's first branch so a scheduled send can resolve an
-- audience rather than failing for want of one.
UPDATE "Broadcast" b
SET "branchId" = (
  SELECT br."id" FROM "Branch" br
  WHERE br."organizationId" = b."organizationId" AND br."deletedAt" IS NULL
  ORDER BY br."createdAt" ASC
  LIMIT 1
)
WHERE b."branchId" IS NULL;
