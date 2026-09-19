-- AlterTable
ALTER TABLE "BookingQuote" ADD COLUMN     "parentOrderId" TEXT;

-- CreateIndex
CREATE INDEX "BookingQuote_parentOrderId_idx" ON "BookingQuote"("parentOrderId");
