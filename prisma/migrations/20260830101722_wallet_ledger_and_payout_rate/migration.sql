-- CreateEnum
CREATE TYPE "WalletEntryType" AS ENUM ('JOB_CREDIT', 'PAYOUT', 'REVERSAL', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "payoutRatePercent" INTEGER;

-- CreateTable
CREATE TABLE "WalletLedger" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "WalletEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "bookingId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletLedger_employeeId_idx" ON "WalletLedger"("employeeId");

-- CreateIndex
CREATE INDEX "WalletLedger_type_idx" ON "WalletLedger"("type");

-- CreateIndex
CREATE UNIQUE INDEX "WalletLedger_bookingId_type_key" ON "WalletLedger"("bookingId", "type");

-- AddForeignKey
ALTER TABLE "WalletLedger" ADD CONSTRAINT "WalletLedger_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
