-- Regra comercial 30/70: participação da WeMob sobre o faturamento bruto elegível e responsável pelas tarifas do gateway.
-- Versões existentes ficam com revenueShareRate NULL (modelo antigo, preservado como histórico).
-- CreateEnum
CREATE TYPE "public"."GatewayFeeBearer" AS ENUM ('PENDING_DECISION', 'WEMOB', 'PARTNER', 'PROPORTIONAL');

-- AlterTable
ALTER TABLE "public"."CommercialModelVersion" ADD COLUMN     "gatewayFeeBearer" "public"."GatewayFeeBearer" NOT NULL DEFAULT 'PENDING_DECISION',
ADD COLUMN     "revenueShareRate" DECIMAL(9,6);

-- AlterTable
ALTER TABLE "public"."ContractVersion" ADD COLUMN     "gatewayFeeBearer" "public"."GatewayFeeBearer" NOT NULL DEFAULT 'PENDING_DECISION',
ADD COLUMN     "revenueShareRate" DECIMAL(9,6);
