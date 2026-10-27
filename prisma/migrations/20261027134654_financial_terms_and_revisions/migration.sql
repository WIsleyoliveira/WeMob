-- CreateEnum
CREATE TYPE "public"."LossTreatment" AS ENUM ('SHARE_MONTHLY', 'CARRY_FORWARD');

-- AlterTable
ALTER TABLE "public"."CommercialModelVersion" ADD COLUMN     "lossTreatment" "public"."LossTreatment" NOT NULL DEFAULT 'SHARE_MONTHLY',
ADD COLUMN     "platformFeeIncludesGateway" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "public"."Simulation" ADD COLUMN     "changes" JSONB,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AddForeignKey
ALTER TABLE "public"."Simulation" ADD CONSTRAINT "Simulation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."Simulation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
