-- DropForeignKey
ALTER TABLE "AttendanceSession" DROP CONSTRAINT "AttendanceSession_takenByStaffId_fkey";

-- AlterTable
ALTER TABLE "AttendanceSession" ADD COLUMN     "lockedByUserId" TEXT,
ADD COLUMN     "takenByUserId" TEXT NOT NULL,
ALTER COLUMN "takenByStaffId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_takenByStaffId_fkey" FOREIGN KEY ("takenByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
