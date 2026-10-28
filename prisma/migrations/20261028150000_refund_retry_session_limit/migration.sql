-- P16: estorno com retentativa segura (cartão só aceita estorno parcial no dia seguinte; limite de requisições)
-- e limite financeiro por sessão de recarga. Somente adições.
ALTER TYPE "public"."RefundStatus" ADD VALUE 'SCHEDULED';

ALTER TABLE "public"."ChargingSession" ADD COLUMN     "fundedAmount" DECIMAL(14,2),
ADD COLUMN     "limitAmount" DECIMAL(14,2),
ADD COLUMN     "limitStopCommandId" TEXT,
ADD COLUMN     "limitStopRequestedAt" TIMESTAMP(3),
ADD COLUMN     "limitWarnedAt" TIMESTAMP(3);

ALTER TABLE "public"."Refund" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "confirmedAmount" DECIMAL(14,2),
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX "Refund_status_nextAttemptAt_idx" ON "public"."Refund"("status", "nextAttemptAt");
