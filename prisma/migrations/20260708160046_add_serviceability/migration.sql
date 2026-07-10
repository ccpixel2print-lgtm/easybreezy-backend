-- CreateTable
CREATE TABLE "ServiceablePincode" (
    "id" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "areaName" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Hyderabad',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceablePincode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AreaLead" (
    "id" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "serviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AreaLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceablePincode_pincode_key" ON "ServiceablePincode"("pincode");
