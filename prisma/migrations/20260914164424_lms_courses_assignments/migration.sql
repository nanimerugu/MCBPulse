-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "createdByStaffId" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "description" TEXT,
ADD COLUMN     "gradeId" TEXT,
ADD COLUMN     "subjectId" TEXT;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "gradedAt" TIMESTAMP(3),
ADD COLUMN     "gradedByStaffId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_gradedByStaffId_fkey" FOREIGN KEY ("gradedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
