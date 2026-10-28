DROP INDEX IF EXISTS "public"."PaymentEvent_processedAt_nextAttemptAt_idx";
ALTER TABLE "public"."PaymentEvent" DROP COLUMN IF EXISTS "nextAttemptAt";
