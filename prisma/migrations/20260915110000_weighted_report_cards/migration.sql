-- AlterTable
ALTER TABLE "GradingScale" ADD COLUMN     "courseworkWeight" INTEGER,
ADD COLUMN     "examWeight" INTEGER;

-- AlterTable
ALTER TABLE "ReportCard" ADD COLUMN     "courseworkWeight" INTEGER,
ADD COLUMN     "examWeight" INTEGER;

-- AlterTable
ALTER TABLE "ReportCardLine" ADD COLUMN     "basisNote" TEXT;
