-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "responseText" TEXT,
ADD COLUMN     "submittedByStudent" BOOLEAN NOT NULL DEFAULT false;
