-- Reversão manual. Estornos ainda agendados viram FAILED (revisar manualmente antes de reverter).
DROP INDEX IF EXISTS "public"."Refund_status_nextAttemptAt_idx";
ALTER TABLE "public"."Refund" DROP COLUMN IF EXISTS "attempts", DROP COLUMN IF EXISTS "confirmedAmount", DROP COLUMN IF EXISTS "lastError", DROP COLUMN IF EXISTS "nextAttemptAt";
ALTER TABLE "public"."ChargingSession" DROP COLUMN IF EXISTS "fundedAmount", DROP COLUMN IF EXISTS "limitAmount", DROP COLUMN IF EXISTS "limitStopCommandId", DROP COLUMN IF EXISTS "limitStopRequestedAt", DROP COLUMN IF EXISTS "limitWarnedAt";
UPDATE "public"."Refund" SET "status" = 'FAILED' WHERE "status" = 'SCHEDULED';
ALTER TYPE "public"."RefundStatus" RENAME TO "RefundStatus_old";
CREATE TYPE "public"."RefundStatus" AS ENUM ('REQUESTED', 'SUCCEEDED', 'FAILED');
ALTER TABLE "public"."Refund" ALTER COLUMN "status" DROP DEFAULT, ALTER COLUMN "status" TYPE "public"."RefundStatus" USING "status"::text::"public"."RefundStatus", ALTER COLUMN "status" SET DEFAULT 'REQUESTED';
DROP TYPE "public"."RefundStatus_old";
