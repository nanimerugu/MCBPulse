-- CreateEnum
CREATE TYPE "ReportCardStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "GradingScale" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "GradingScale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradingBand" (
    "id" TEXT NOT NULL,
    "gradingScaleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "minPercent" INTEGER NOT NULL,
    "description" TEXT,

    CONSTRAINT "GradingBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportCard" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "gradingScaleId" TEXT,
    "term" TEXT NOT NULL,
    "status" "ReportCardStatus" NOT NULL DEFAULT 'DRAFT',
    "overallPercent" INTEGER,
    "overallBand" TEXT,
    "attendancePercent" INTEGER,
    "remarks" TEXT,
    "generatedByUserId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "ReportCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportCardLine" (
    "id" TEXT NOT NULL,
    "reportCardId" TEXT NOT NULL,
    "subjectId" TEXT,
    "subjectName" TEXT NOT NULL,
    "examMarks" INTEGER,
    "examMax" INTEGER,
    "assignmentMarks" INTEGER,
    "assignmentMax" INTEGER,
    "percent" INTEGER,
    "band" TEXT,
    "comment" TEXT,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "ReportCardLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GradingScale_organizationId_name_key" ON "GradingScale"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "GradingBand_gradingScaleId_label_key" ON "GradingBand"("gradingScaleId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "GradingBand_gradingScaleId_minPercent_key" ON "GradingBand"("gradingScaleId", "minPercent");

-- CreateIndex
CREATE INDEX "ReportCard_academicYearId_term_idx" ON "ReportCard"("academicYearId", "term");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCard_studentId_academicYearId_term_key" ON "ReportCard"("studentId", "academicYearId", "term");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCardLine_reportCardId_sequence_key" ON "ReportCardLine"("reportCardId", "sequence");

-- AddForeignKey
ALTER TABLE "GradingScale" ADD CONSTRAINT "GradingScale_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingBand" ADD CONSTRAINT "GradingBand_gradingScaleId_fkey" FOREIGN KEY ("gradingScaleId") REFERENCES "GradingScale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_gradingScaleId_fkey" FOREIGN KEY ("gradingScaleId") REFERENCES "GradingScale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCardLine" ADD CONSTRAINT "ReportCardLine_reportCardId_fkey" FOREIGN KEY ("reportCardId") REFERENCES "ReportCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCardLine" ADD CONSTRAINT "ReportCardLine_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
