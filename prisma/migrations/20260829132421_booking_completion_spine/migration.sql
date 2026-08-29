-- CreateEnum
CREATE TYPE "BookingPhotoKind" AS ENUM ('BEFORE', 'AFTER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookingStatus" ADD VALUE 'ACCEPTED';
ALTER TYPE "BookingStatus" ADD VALUE 'REJECTED';
ALTER TYPE "BookingStatus" ADD VALUE 'AWAITING_CONFIRMATION';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedById" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "workDoneAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BookingPhoto" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "kind" "BookingPhotoKind" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingPhoto_bookingId_idx" ON "BookingPhoto"("bookingId");

-- AddForeignKey
ALTER TABLE "BookingPhoto" ADD CONSTRAINT "BookingPhoto_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
