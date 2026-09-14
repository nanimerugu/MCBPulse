-- CreateEnum
CREATE TYPE "YearOutcome" AS ENUM ('PROMOTED', 'RETAINED', 'GRADUATED', 'UNPLACED');

-- CreateTable
CREATE TABLE "StudentYearOutcome" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "outcome" "YearOutcome" NOT NULL,
    "fromSectionId" TEXT,
    "toSectionId" TEXT,
    "note" TEXT,
    "decidedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentYearOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentYearOutcome_academicYearId_idx" ON "StudentYearOutcome"("academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentYearOutcome_studentId_academicYearId_key" ON "StudentYearOutcome"("studentId", "academicYearId");

-- AddForeignKey
ALTER TABLE "StudentYearOutcome" ADD CONSTRAINT "StudentYearOutcome_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentYearOutcome" ADD CONSTRAINT "StudentYearOutcome_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
