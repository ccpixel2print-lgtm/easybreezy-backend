/*
  Warnings:

  - You are about to drop the column `durationMins` on the `Service` table. All the data in the column will be lost.
  - You are about to drop the column `durationMins` on the `SubService` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name]` on the table `ServiceCategory` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Service" DROP COLUMN "durationMins",
ADD COLUMN     "durationLabel" TEXT,
ADD COLUMN     "imageAlt" TEXT,
ADD COLUMN     "longDescription" TEXT,
ADD COLUMN     "startingPrice" INTEGER;

-- AlterTable
ALTER TABLE "SubService" DROP COLUMN "durationMins",
ADD COLUMN     "durationLabel" TEXT,
ADD COLUMN     "imageAlt" TEXT,
ADD COLUMN     "originalPrice" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategory_name_key" ON "ServiceCategory"("name");
