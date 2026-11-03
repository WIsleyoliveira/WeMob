-- P23: estações favoritas do motorista e rótulo/último uso dos aparelhos conectados (sem User-Agent nem IP).
-- AlterTable
ALTER TABLE "public"."DriverSession" ADD COLUMN     "deviceLabel" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."DriverFavoriteStation" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverFavoriteStation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriverFavoriteStation_driverId_stationId_key" ON "public"."DriverFavoriteStation"("driverId", "stationId");

-- AddForeignKey
ALTER TABLE "public"."DriverFavoriteStation" ADD CONSTRAINT "DriverFavoriteStation_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DriverFavoriteStation" ADD CONSTRAINT "DriverFavoriteStation_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "public"."ChargingStation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
