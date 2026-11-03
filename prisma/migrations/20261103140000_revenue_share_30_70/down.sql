ALTER TABLE "public"."ContractVersion" DROP COLUMN IF EXISTS "revenueShareRate";
ALTER TABLE "public"."ContractVersion" DROP COLUMN IF EXISTS "gatewayFeeBearer";
ALTER TABLE "public"."CommercialModelVersion" DROP COLUMN IF EXISTS "revenueShareRate";
ALTER TABLE "public"."CommercialModelVersion" DROP COLUMN IF EXISTS "gatewayFeeBearer";
DROP TYPE IF EXISTS "public"."GatewayFeeBearer";
