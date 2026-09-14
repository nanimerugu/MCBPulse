-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- AlterTable
ALTER TABLE "Exam" ADD COLUMN     "instructions" TEXT,
ADD COLUMN     "status" "ExamStatus" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "ExamAttempt" ADD COLUMN     "gradedAt" TIMESTAMP(3),
ADD COLUMN     "gradedByStaffId" TEXT;

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "explanation" TEXT;

-- CreateTable
CREATE TABLE "QuestionOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "QuestionOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamPaperQuestion" (
    "id" TEXT NOT NULL,
    "examPaperId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "marks" INTEGER NOT NULL,

    CONSTRAINT "ExamPaperQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamAnswer" (
    "id" TEXT NOT NULL,
    "examAttemptId" TEXT NOT NULL,
    "examPaperQuestionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedOptionId" TEXT,
    "responseText" TEXT,
    "marksAwarded" INTEGER,
    "autoGraded" BOOLEAN NOT NULL DEFAULT false,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuestionOption_questionId_sequence_key" ON "QuestionOption"("questionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaperQuestion_examPaperId_sequence_key" ON "ExamPaperQuestion"("examPaperId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaperQuestion_examPaperId_questionId_key" ON "ExamPaperQuestion"("examPaperId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamAnswer_examAttemptId_examPaperQuestionId_key" ON "ExamAnswer"("examAttemptId", "examPaperQuestionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaper_examId_version_key" ON "ExamPaper"("examId", "version");

-- CreateIndex
CREATE INDEX "Question_questionBankId_type_difficulty_idx" ON "Question"("questionBankId", "type", "difficulty");

-- AddForeignKey
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaperQuestion" ADD CONSTRAINT "ExamPaperQuestion_examPaperId_fkey" FOREIGN KEY ("examPaperId") REFERENCES "ExamPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaperQuestion" ADD CONSTRAINT "ExamPaperQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAnswer" ADD CONSTRAINT "ExamAnswer_examAttemptId_fkey" FOREIGN KEY ("examAttemptId") REFERENCES "ExamAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAnswer" ADD CONSTRAINT "ExamAnswer_examPaperQuestionId_fkey" FOREIGN KEY ("examPaperQuestionId") REFERENCES "ExamPaperQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAnswer" ADD CONSTRAINT "ExamAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAnswer" ADD CONSTRAINT "ExamAnswer_selectedOptionId_fkey" FOREIGN KEY ("selectedOptionId") REFERENCES "QuestionOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
