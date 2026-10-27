-- Reversão manual (com backup e autorização). Remove clientes do gateway, operações idempotentes, recebedores,
-- políticas e splits, habilitações de produção e as colunas novas de Driver/Payment/Refund.
-- O valor 'EXPIRED' do enum ChargeRequestStatus não pode ser removido com ALTER TYPE; pedidos EXPIRED
-- devem ser migrados para 'CANCELLED' antes de recriar o tipo, se necessário.
DROP INDEX IF EXISTS "Payment_one_live_per_session";
DROP TABLE IF EXISTS "GatewayActivation", "PaymentSplit", "SplitParticipant", "SplitPolicy", "PaymentRecipient", "PaymentOperation", "GatewayCustomer" CASCADE;
DROP TYPE IF EXISTS "ActivationStatus", "SplitPolicyStatus", "RecipientStatus", "PaymentOperationStatus";
ALTER TABLE "Refund" DROP COLUMN IF EXISTS "remoteStatus";
ALTER TABLE "Driver" DROP COLUMN IF EXISTS "documentEnc", DROP COLUMN IF EXISTS "documentHint";
ALTER TABLE "Payment" DROP COLUMN IF EXISTS "operatorId", DROP COLUMN IF EXISTS "method", DROP COLUMN IF EXISTS "remoteStatus", DROP COLUMN IF EXISTS "netValue",
  DROP COLUMN IF EXISTS "feeAmount", DROP COLUMN IF EXISTS "externalReference", DROP COLUMN IF EXISTS "pixPayload", DROP COLUMN IF EXISTS "pixExpiresAt",
  DROP COLUMN IF EXISTS "invoiceUrl", DROP COLUMN IF EXISTS "splitPolicyId", DROP COLUMN IF EXISTS "splitPolicyVersion", DROP COLUMN IF EXISTS "lastSyncedAt",
  DROP COLUMN IF EXISTS "reviewReason", DROP COLUMN IF EXISTS "reviewOpenedAt", DROP COLUMN IF EXISTS "reviewResolvedAt", DROP COLUMN IF EXISTS "reviewResolvedById", DROP COLUMN IF EXISTS "reviewNote";
