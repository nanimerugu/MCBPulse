-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN     "approvedByUserId" TEXT,
ADD COLUMN     "body" TEXT NOT NULL,
ADD COLUMN     "createdByUserId" TEXT NOT NULL,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "subject" TEXT;

-- AlterTable
ALTER TABLE "Guardian" ADD COLUMN     "optOutEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "optOutSms" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "body" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "recipientName" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "quietHoursEnd" TEXT,
ADD COLUMN     "quietHoursStart" TEXT;

-- CreateIndex
CREATE INDEX "Message_organizationId_createdAt_idx" ON "Message"("organizationId", "createdAt");
