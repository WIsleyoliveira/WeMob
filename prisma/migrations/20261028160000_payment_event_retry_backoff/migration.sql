-- P16: espera crescente nas retentativas de webhooks (sem martelar o gateway; sem fila presa pelos mais antigos).
ALTER TABLE "public"."PaymentEvent" ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);
CREATE INDEX "PaymentEvent_processedAt_nextAttemptAt_idx" ON "public"."PaymentEvent"("processedAt", "nextAttemptAt");
