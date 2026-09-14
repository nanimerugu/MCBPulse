-- CreateTable
CREATE TABLE "PeriodRegister" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "takenByUserId" TEXT NOT NULL,
    "takenByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeriodRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodMark" (
    "id" TEXT NOT NULL,
    "registerId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "remarks" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PeriodMark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Substitution" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "absentStaffId" TEXT NOT NULL,
    "substituteStaffId" TEXT NOT NULL,
    "reason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Substitution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PeriodRegister_slotId_date_key" ON "PeriodRegister"("slotId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PeriodMark_registerId_studentId_key" ON "PeriodMark"("registerId", "studentId");

-- CreateIndex
CREATE INDEX "Substitution_substituteStaffId_date_idx" ON "Substitution"("substituteStaffId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Substitution_slotId_date_key" ON "Substitution"("slotId", "date");

-- AddForeignKey
ALTER TABLE "PeriodRegister" ADD CONSTRAINT "PeriodRegister_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "TimetableSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodRegister" ADD CONSTRAINT "PeriodRegister_takenByStaffId_fkey" FOREIGN KEY ("takenByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodMark" ADD CONSTRAINT "PeriodMark_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "PeriodRegister"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodMark" ADD CONSTRAINT "PeriodMark_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Substitution" ADD CONSTRAINT "Substitution_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "TimetableSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Substitution" ADD CONSTRAINT "Substitution_absentStaffId_fkey" FOREIGN KEY ("absentStaffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Substitution" ADD CONSTRAINT "Substitution_substituteStaffId_fkey" FOREIGN KEY ("substituteStaffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
